import { prisma } from '../lib/prisma';
import { OrderStatus, PartnerCategory } from '@prisma/client';
import { generateId } from '../utils/id-generator.util';
import { logger } from '../lib/logger';
import {
  getPossibleLogisticsProviderIds,
  getLogisticsProviderWarehouses,
  buildLogisticsProviderOrderWhere,
  verifyWarehouseOwnership,
} from '../utils/logistics-provider.util';

export interface TransitLeg {
  leg?: number;
  from: string;
  to: string;
  status: string;
  updatedAt: string;
  completedAt?: string;
  warehouseId?: string;
  warehouseName?: string;
  originWarehouseId?: string;
  originWarehouseName?: string;
  destinationWarehouseId?: string;
  destinationWarehouseName?: string;
  finalDeliveryLat?: number;
  finalDeliveryLng?: number;
  finalDeliveryAddress?: string;
  finalDeliveryWarehouseId?: string;
  deliveryOrderId?: string;
  createdAt?: string;
}

export interface CreateLogisticsOrderInput {
  logisticsProviderId: string;
  partnerId: string;
  originWarehouseId: string;
  dropLat: number;
  dropLng: number;
  dropAddressText?: string;
  dropWarehouseId?: string;
  transitTrackingNumber?: string;
  expectedWarehouseArrival?: Date;
  orderAmount?: number;
  priority?: 'HIGH' | 'NORMAL' | 'LOW';
}

export interface UpdateTransitStatusInput {
  orderId: string;
  transitStatus: string;
  currentWarehouseId?: string;
  transitLegs?: TransitLeg[];
  expectedWarehouseArrival?: Date;
}

/**
 * Logistics Service - Handles multi-leg delivery flow
 * 
 * ORDER FLOW:
 * Leg 1: Seller → Origin Warehouse (Regular agent)
 *   - Order created with originWarehouseId
 *   - dropWarehouseId = originWarehouseId (for Leg 1 delivery)
 *   - Status: SEARCHING_AGENT → ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → AT_WAREHOUSE
 *   - When completed: currentWarehouseId = originWarehouseId, status = AT_WAREHOUSE
 * 
 * Leg 2: Origin Warehouse → Destination Warehouse (Logistics agent)
 *   - Logistics provider sees order at origin warehouse (AT_WAREHOUSE)
 *   - Logistics provider assigns logistics agent
 *   - Logistics agent picks up → status becomes IN_TRANSIT
 *   - Logistics provider updates transit status during transport
 *   - When arrives at destination: Status → AT_WAREHOUSE, currentWarehouseId = destinationWarehouseId
 *   - Logistics provider marks as READY_FOR_PICKUP
 * 
 * Leg 3: Destination Warehouse → Customer (Regular agent)
 *   - System creates delivery order automatically when marked READY_FOR_PICKUP
 *   - Regular agent picks up and delivers to customer
 */
export const logisticsService = {
  /**
   * Create a logistics order (multi-leg delivery)
   * Order starts in IN_TRANSIT status
   */
  async createLogisticsOrder(input: CreateLogisticsOrderInput) {
    // Verify logistics provider
    const logisticsProvider = await prisma.logisticsProvider.findUnique({
      where: { id: input.logisticsProviderId },
      select: { id: true, isActive: true },
    });

    if (!logisticsProvider) {
      throw new Error('Logistics provider not found');
    }

    if (!logisticsProvider.isActive) {
      throw new Error('Logistics provider is not active');
    }

    // Verify origin warehouse belongs to logistics provider
    const originWarehouse = await prisma.warehouse.findUnique({
      where: { id: input.originWarehouseId },
      select: { id: true, partnerId: true, logisticsProviderId: true, latitude: true, longitude: true, name: true },
    });

    if (!originWarehouse) {
      throw new Error('Origin warehouse not found');
    }

    // Check if warehouse belongs to logistics provider (either via logisticsProviderId or partnerId)
    const warehouseBelongsToProvider = 
      originWarehouse.logisticsProviderId === input.logisticsProviderId ||
      originWarehouse.partnerId === input.logisticsProviderId;

    if (!warehouseBelongsToProvider) {
      throw new Error('Origin warehouse does not belong to logistics provider');
    }

    // Verify partner exists
    const partner = await prisma.partner.findUnique({
      where: { id: input.partnerId },
      select: { id: true, category: true },
    });

    if (!partner) {
      throw new Error('Partner not found');
    }

    // Generate order ID and tracking number
    const orderId = await generateId('ORD');
    const transitTrackingNumber = input.transitTrackingNumber || `TRK${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Create order in IN_TRANSIT status
    const order = await prisma.order.create({
      data: {
        id: orderId,
        partnerId: input.partnerId,
        logisticsProviderId: input.logisticsProviderId,
        originWarehouseId: input.originWarehouseId,
        currentWarehouseId: input.originWarehouseId,
        pickupLat: originWarehouse.latitude,
        pickupLng: originWarehouse.longitude,
        dropLat: input.dropLat,
        dropLng: input.dropLng,
        dropAddressText: input.dropAddressText || null,
        dropWarehouseId: input.dropWarehouseId || null,
        transitTrackingNumber,
        transitStatus: 'Dispatched',
        status: OrderStatus.IN_TRANSIT,
        priority: input.priority || 'NORMAL',
        payoutAmount: 0,
        orderAmount: input.orderAmount || null,
        partnerCategory: partner.category,
        expectedWarehouseArrival: input.expectedWarehouseArrival || null,
        transitLegs: input.originWarehouseId ? [{
          from: 'Origin',
          to: 'In Transit',
          status: 'Dispatched',
          updatedAt: new Date().toISOString(),
        }] as any : undefined,
      },
      include: {
        partner: {
          select: {
            id: true,
            companyName: true,
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        logisticsProvider: {
          select: {
            id: true,
            companyName: true,
          },
        },
        originWarehouse: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    return order;
  },


  /**
   * Extract destination warehouse from transit legs
   */
  extractDestinationWarehouse(transitLegs: any): string | null {
    if (!Array.isArray(transitLegs)) return null;
    
    // Priority 1: Get from Leg 2 (ORIGIN_WAREHOUSE → DESTINATION_WAREHOUSE)
    const leg2 = transitLegs.find((leg: any) => leg.leg === 2);
    if (leg2 && leg2.destinationWarehouseId) {
      return leg2.destinationWarehouseId;
    }
    
    // Priority 2: Get from Leg 3 warehouseId (DESTINATION_WAREHOUSE → DELIVERY)
    const leg3 = transitLegs.find((leg: any) => leg.leg === 3);
    if (leg3 && leg3.warehouseId) {
      return leg3.warehouseId;
    }
    
    return null;
  },

  /**
   * Update transit status (logistics provider updates order during transit)
   * Handles Leg 2: Origin Warehouse → Destination Warehouse
   */
  async updateTransitStatus(input: UpdateTransitStatusInput, logisticsProviderId: string) {
    const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, {
      id: input.orderId,
    });

    const order = await prisma.order.findFirst({
      where,
      select: {
        id: true,
        logisticsProviderId: true,
        status: true,
        transitLegs: true,
        currentWarehouseId: true,
        originWarehouseId: true,
        dropWarehouseId: true,
      },
    });

    if (!order) {
      throw new Error('Order not found or does not belong to this logistics provider');
    }

    // Extract destination warehouse from transit legs
    const destinationWarehouseId = this.extractDestinationWarehouse(order.transitLegs);
    
    // Validate origin and destination are different
    if (order.originWarehouseId && destinationWarehouseId) {
      if (order.originWarehouseId === destinationWarehouseId) {
        throw new Error('Origin warehouse and destination warehouse cannot be the same. Please fix the order configuration.');
      }
    }

    // Validate currentWarehouseId if provided
    if (input.currentWarehouseId) {
      if (order.originWarehouseId === input.currentWarehouseId && destinationWarehouseId) {
        if (input.currentWarehouseId === destinationWarehouseId) {
          throw new Error('Cannot use the same warehouse as both origin and destination.');
        }
      }
    }

    // Build transit legs array
    const existingLegs: TransitLeg[] = Array.isArray(order.transitLegs)
      ? (order.transitLegs as any)
      : [];

    let updatedLegs = [...existingLegs];
    const transitStatusLower = input.transitStatus.toLowerCase();

    // Determine what leg we're updating
    const isAtOriginWarehouse = input.currentWarehouseId === order.originWarehouseId;
    const isAtDestinationWarehouse = destinationWarehouseId && input.currentWarehouseId === destinationWarehouseId;
    
    // ✅ FIXED: Batch warehouse queries to avoid N+1
    const warehouseIds = [
      input.currentWarehouseId,
      order.originWarehouseId,
      destinationWarehouseId,
    ].filter(Boolean) as string[];

    const warehouses = warehouseIds.length > 0
      ? await prisma.warehouse.findMany({
          where: { id: { in: warehouseIds } },
          select: { id: true, name: true },
        })
      : [];

    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

    // Get warehouse name for display
    let toLocation = input.transitStatus;
    if (input.currentWarehouseId) {
      const warehouse = warehouseMap.get(input.currentWarehouseId);
      toLocation = warehouse?.name || 'Current Warehouse';
    }

    // Update Leg 2 (ORIGIN_WAREHOUSE → DESTINATION_WAREHOUSE)
    if (!isAtOriginWarehouse && (isAtDestinationWarehouse || destinationWarehouseId)) {
      let leg2 = updatedLegs.find((leg: any) => leg.leg === 2);
      
      if (!leg2 && order.originWarehouseId && destinationWarehouseId) {
        // Create Leg 2 if it doesn't exist
        const originWarehouse = warehouseMap.get(order.originWarehouseId);
        const destWarehouse = warehouseMap.get(destinationWarehouseId);
        
        leg2 = {
          leg: 2,
          from: originWarehouse?.name || 'ORIGIN_WAREHOUSE',
          to: destWarehouse?.name || 'DESTINATION_WAREHOUSE',
          status: input.transitStatus,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          originWarehouseId: order.originWarehouseId,
          destinationWarehouseId: destinationWarehouseId,
          originWarehouseName: originWarehouse?.name,
          destinationWarehouseName: destWarehouse?.name,
        };
        updatedLegs.push(leg2);
      } else if (leg2) {
        // Update existing Leg 2
        leg2.status = input.transitStatus;
        leg2.updatedAt = new Date().toISOString();
        if (input.currentWarehouseId && input.currentWarehouseId === destinationWarehouseId) {
          leg2.warehouseId = input.currentWarehouseId;
        }
        if (!leg2.createdAt) {
          leg2.createdAt = new Date().toISOString();
        }
        
        // Mark as completed if arrived at destination
        if (isAtDestinationWarehouse && (transitStatusLower.includes('arrived') || transitStatusLower.includes('warehouse'))) {
          leg2.status = 'COMPLETED';
          leg2.completedAt = new Date().toISOString();
        }
        
        const leg2Index = updatedLegs.findIndex((leg: any) => leg.leg === 2);
        if (leg2Index >= 0) {
          updatedLegs[leg2Index] = leg2;
        }
      }
    }

    // Update current warehouse location if provided
    // ✅ FIXED: Use already fetched warehouse data
    let pickupLat = undefined;
    let pickupLng = undefined;
    if (input.currentWarehouseId) {
      // Fetch coordinates if not already in warehouseMap (different select)
      const warehouseWithCoords = await prisma.warehouse.findUnique({
        where: { id: input.currentWarehouseId },
        select: { latitude: true, longitude: true },
      });
      if (warehouseWithCoords) {
        pickupLat = warehouseWithCoords.latitude;
        pickupLng = warehouseWithCoords.longitude;
      }
    }

    // Determine order status based on transit status and location
    let orderStatus = undefined;
    
    if (isAtDestinationWarehouse && (transitStatusLower.includes('warehouse') || transitStatusLower.includes('arrived') || transitStatusLower.includes('destination'))) {
      // Arrived at destination warehouse
      orderStatus = OrderStatus.AT_WAREHOUSE as any;
    } else if (transitStatusLower.includes('transit') || transitStatusLower.includes('dispatched') || transitStatusLower.includes('shipped') || transitStatusLower.includes('out for')) {
      // In transit
      orderStatus = OrderStatus.IN_TRANSIT as any;
    } else if (input.currentWarehouseId && (transitStatusLower.includes('warehouse') || transitStatusLower.includes('arrived'))) {
      // At a warehouse (but not destination)
      orderStatus = OrderStatus.AT_WAREHOUSE as any;
    }

    // Update order
    const updatedOrder = await prisma.order.update({
      where: { id: input.orderId },
      data: {
        transitStatus: input.transitStatus,
        currentWarehouseId: input.currentWarehouseId || undefined,
        pickupLat: pickupLat || undefined,
        pickupLng: pickupLng || undefined,
        transitLegs: updatedLegs as any,
        expectedWarehouseArrival: input.expectedWarehouseArrival || undefined,
        status: orderStatus || undefined,
        warehouseArrivedAt: input.currentWarehouseId ? new Date() : undefined,
        updatedAt: new Date(),
      } as any,
      include: {
        logisticsProvider: {
          select: {
            id: true,
            companyName: true,
          },
        },
        currentWarehouse: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    return updatedOrder;
  },

  /**
   * Mark order as arrived at warehouse
   */
  async markAtWarehouse(orderId: string, warehouseId: string, logisticsProviderId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        logisticsProviderId,
      },
      select: {
        id: true,
        logisticsProviderId: true,
        status: true,
        transitLegs: true,
        originWarehouseId: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.logisticsProviderId !== logisticsProviderId) {
      throw new Error('Unauthorized: Order is not assigned to this logistics provider');
    }

    // Verify warehouse belongs to logistics provider
    const warehouse = await prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        OR: [
          { logisticsProviderId: logisticsProviderId },
          { partnerId: logisticsProviderId, partner: { category: 'LOGISTICS_PROVIDER' } },
        ],
      },
      select: { id: true, logisticsProviderId: true, partnerId: true, latitude: true, longitude: true, name: true },
    });

    if (!warehouse) {
      throw new Error('Warehouse not found or does not belong to this logistics provider');
    }

    // Get existing transit legs
    const existingLegs: TransitLeg[] = Array.isArray(order.transitLegs)
      ? (order.transitLegs as any)
      : [];

    // Update leg 1 if this is the origin warehouse
    let updatedLegs = [...existingLegs];
    if (warehouseId === order.originWarehouseId) {
      const leg1 = updatedLegs.find((leg: any) => leg.leg === 1);
      if (leg1) {
        leg1.status = 'COMPLETED';
        leg1.updatedAt = new Date().toISOString();
        leg1.completedAt = new Date().toISOString();
        if (!leg1.createdAt) {
          leg1.createdAt = new Date().toISOString();
        }
        const leg1Index = updatedLegs.findIndex((leg: any) => leg.leg === 1);
        if (leg1Index >= 0) {
          updatedLegs[leg1Index] = leg1;
        }
      }
    }

    // Update order status and location
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.AT_WAREHOUSE as any,
        currentWarehouseId: warehouseId,
        pickupLat: warehouse.latitude,
        pickupLng: warehouse.longitude,
        warehouseArrivedAt: new Date(),
        transitStatus: 'At Warehouse',
        transitLegs: updatedLegs as any,
        updatedAt: new Date(),
      } as any,
      include: {
        currentWarehouse: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    return updatedOrder;
  },

  /**
   * Mark order as ready for agent pickup
   * This completes Leg 2 and transitions to Leg 3 (final delivery)
   */
  async markReadyForPickup(orderId: string, warehouseId: string, logisticsProviderId: string, notes?: string) {
    const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, {
      id: orderId,
    });

    const order = await prisma.order.findFirst({
      where,
      select: {
        id: true,
        logisticsProviderId: true,
        status: true,
        dropLat: true,
        dropLng: true,
        transitLegs: true,
        currentWarehouseId: true,
        dropWarehouseId: true,
        originWarehouseId: true,
        partnerId: true,
      },
    });

    if (!order) {
      throw new Error('Order not found or does not belong to this logistics provider');
    }
    
    if (!order.partnerId) {
      throw new Error('Order does not have a partner ID for pricing calculation');
    }

    // Extract destination warehouse from transit legs
    const destinationWarehouseId = this.extractDestinationWarehouse(order.transitLegs);
    
    // Validate origin and destination are different
    if (order.originWarehouseId && destinationWarehouseId) {
      if (order.originWarehouseId === destinationWarehouseId) {
        throw new Error('Origin warehouse and destination warehouse cannot be the same. Please fix the order configuration.');
      }
    }
    
    // Verify this is the destination warehouse
    const isAtDestinationWarehouse = 
      order.currentWarehouseId === warehouseId || 
      order.dropWarehouseId === warehouseId ||
      (destinationWarehouseId && destinationWarehouseId === warehouseId);
    
    if (!isAtDestinationWarehouse) {
      throw new Error(`Order is not at the destination warehouse. Current: ${order.currentWarehouseId}, Destination: ${destinationWarehouseId || 'not set'}, Specified: ${warehouseId}`);
    }
    
    // Verify order status allows marking as ready
    if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED) {
      throw new Error(`Cannot mark order as ready for pickup. Current status: ${order.status}`);
    }

    // Get existing transit legs
    const existingLegs: TransitLeg[] = Array.isArray(order.transitLegs)
      ? (order.transitLegs as any)
      : [];

    // Verify warehouse belongs to this logistics provider
    const warehouse = await prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        OR: [
          { logisticsProviderId: logisticsProviderId },
          { partnerId: logisticsProviderId, partner: { category: 'LOGISTICS_PROVIDER' } },
        ],
      },
      select: { id: true, logisticsProviderId: true, partnerId: true, latitude: true, longitude: true, name: true },
    });

    if (!warehouse) {
      throw new Error('Warehouse not found or does not belong to this logistics provider');
    }

    // Determine final delivery coordinates from Leg 3
    let finalDropLat = order.dropLat;
    let finalDropLng = order.dropLng;
    const leg3 = existingLegs.find((leg: any) => leg.leg === 3);

    if (leg3 && leg3.finalDeliveryLat && leg3.finalDeliveryLng) {
      finalDropLat = leg3.finalDeliveryLat;
      finalDropLng = leg3.finalDeliveryLng;
    }

    // Validate drop coordinates
    if (!finalDropLat || !finalDropLng) {
      throw new Error('Order is missing delivery coordinates. Please ensure the order has a valid delivery location.');
    }

    // Calculate pricing for final leg (warehouse to customer)
    const { pricingService } = await import('./pricing.service');
    let pricing;
    try {
      pricing = await pricingService.calculateOrderPricing({
        partnerId: order.partnerId,
        pickupLat: warehouse.latitude,
        pickupLng: warehouse.longitude,
        dropLat: finalDropLat,
        dropLng: finalDropLng,
        isSurge: false,
      });
    } catch (error: any) {
      logger.error('[Logistics Service] Pricing calculation error', error);
      throw new Error(`Failed to calculate pricing: ${error.message || 'Unknown error'}`);
    }

    // Get pricing profile
    let pricingProfile;
    try {
      pricingProfile = await pricingService.getPricingProfile(order.partnerId);
    } catch (error: any) {
      logger.error('[Logistics Service] Pricing profile error', error);
      throw new Error(`Failed to get pricing profile: ${error.message || 'Unknown error'}`);
    }

    // Complete Leg 2 in transit legs
    const updatedLegs = [...existingLegs];
    const leg2 = updatedLegs.find((leg: any) => leg.leg === 2);
    if (leg2) {
      leg2.status = 'COMPLETED';
      leg2.completedAt = new Date().toISOString();
      leg2.updatedAt = new Date().toISOString();
      leg2.warehouseId = warehouseId;
      const leg2Index = updatedLegs.findIndex((leg: any) => leg.leg === 2);
      if (leg2Index >= 0) {
        updatedLegs[leg2Index] = leg2;
      }
    }

    // Create delivery order for Leg 3 if needed
    let deliveryOrderId: string | null = null;
    try {
      if (leg3 && leg3.finalDeliveryLat && leg3.finalDeliveryLng) {
        const { logisticsOrderService } = await import('./logistics-order.service');
        const deliveryOrder = await logisticsOrderService.createDeliveryOrderFromWarehouse(
          orderId,
          warehouseId,
          leg3.finalDeliveryLat,
          leg3.finalDeliveryLng,
          leg3.finalDeliveryAddress || 'Customer Address',
          leg3.finalDeliveryWarehouseId
        );
        deliveryOrderId = deliveryOrder.id;
      }
    } catch (error: any) {
      logger.error('[Logistics Service] Error creating delivery order', error);
      // Don't fail the order update if delivery order creation fails
    }

    // Update order to READY_FOR_PICKUP
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.READY_FOR_PICKUP,
        pickupWarehouseId: warehouseId,
        pickupLat: warehouse.latitude,
        pickupLng: warehouse.longitude,
        readyForPickupAt: new Date(),
        payoutAmount: pricing.agentPayout,
        partnerPayment: pricing.partnerPayment,
        agentPayout: pricing.agentPayout,
        adminCommission: pricing.adminCommission,
        distanceKm: pricing.distanceKm,
        transitStatus: 'Ready for Pickup',
        logisticsAgentId: null, // Clear logistics agent - Leg 2 complete
        agentId: null, // Ensure no regular agent assigned yet
        transitLegs: [
          ...updatedLegs,
          {
            from: warehouse.name || 'Warehouse',
            to: 'Ready for Agent Pickup',
            status: 'Ready for Pickup',
            updatedAt: new Date().toISOString(),
            ...(deliveryOrderId ? { deliveryOrderId } : {}),
          },
        ] as any,
        commissionRate: typeof pricingProfile.agentSharePct === 'number' ? (100 - pricingProfile.agentSharePct) : 30,
        updatedAt: new Date(),
      },
      include: {
        pickupWarehouse: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
        partner: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
    });

    // ✅ FIXED: Process immediately instead of setTimeout
    // This ensures order state is consistent and errors are properly handled
    try {
      // Immediately transition to SEARCHING_AGENT
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.SEARCHING_AGENT,
        },
      });

      // Trigger assignment service with proper error handling
      const { assignOrder } = await import('./assignment.service');
      const assignmentResult = await assignOrder({
        orderId: updatedOrder.id,
        pickupLat: warehouse.latitude,
        pickupLng: warehouse.longitude,
        payoutAmount: pricing.agentPayout,
        priority: (updatedOrder.priority as 'HIGH' | 'NORMAL' | 'LOW') || 'NORMAL',
        maxRadius: 5000,
        maxAgentsToOffer: 5,
        offerTimeout: 30,
      }).catch((error) => {
        // Log error but don't fail the entire operation
        // The order is already in SEARCHING_AGENT status, so assignment can be retried
        logger.error('Assignment failed for order', error, { orderId });
        return { success: false, error };
      });

      if (!assignmentResult || (assignmentResult as any).success === false) {
        logger.warn('Order assignment did not succeed', {
          orderId,
          result: assignmentResult,
        });
      }
    } catch (error) {
      // If status update fails, log and rethrow - this is a critical error
      logger.error('Failed to transition order to SEARCHING_AGENT', error, { orderId });
      throw error;
    }

    return updatedOrder;
  },

  /**
   * Get logistics orders for a logistics provider
   */
  async getLogisticsOrders(logisticsProviderId: string, filters?: {
    status?: OrderStatus[];
    limit?: number;
    offset?: number;
  }) {
    const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, 
      filters?.status && filters.status.length > 0
        ? { status: { in: filters.status } }
        : {}
    );

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          partner: {
            select: {
              id: true,
              companyName: true,
              category: true,
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
          logisticsProvider: {
            select: {
              id: true,
              companyName: true,
            },
          },
          originWarehouse: {
            select: {
              id: true,
              name: true,
              address: true,
            },
          },
          currentWarehouse: {
            select: {
              id: true,
              name: true,
              address: true,
            },
          },
          pickupWarehouse: {
            select: {
              id: true,
              name: true,
              address: true,
            },
          },
          dropWarehouse: {
            select: {
              id: true,
              name: true,
              address: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      prisma.order.count({ where }),
    ]);

    return { orders, total };
  },

  /**
   * Get logistics order details
   */
  async getLogisticsOrderDetails(orderId: string, logisticsProviderId: string) {
    const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, {
      id: orderId,
    });

    const order = await prisma.order.findFirst({
      where,
      include: {
        partner: {
          select: {
            id: true,
            companyName: true,
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        logisticsProvider: {
          select: {
            id: true,
            companyName: true,
          },
        },
        originWarehouse: true,
        currentWarehouse: true,
        pickupWarehouse: true,
        dropWarehouse: true,
        agent: {
          select: {
            id: true,
            user: {
              select: {
                name: true,
                phone: true,
              },
            },
            vehicleType: true,
          },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found or does not belong to this logistics provider');
    }

    return order;
  },
};









