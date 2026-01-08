import { prisma } from '../lib/prisma';
import { pricingService } from './pricing.service';
import { OrderStatus, PartnerCategory } from '@prisma/client';
import { generateId } from '../utils/id-generator.util';

/**
 * Service to handle automatic order creation for multi-leg logistics flow
 * 
 * EDGE CASE HANDLING:
 * - Case 3: Customer cancels after Leg 2 - Convert to RTO flow, reverse logistics via provider
 * - Case 4: Leg 3 delivery failure - Standard retry → RTO, do NOT reopen Leg 2
 */
export const logisticsOrderService = {
  /**
   * Creates a delivery order from destination warehouse to final customer location
   * This is called automatically when an order reaches the destination warehouse
   */
  async createDeliveryOrderFromWarehouse(
    parentOrderId: string,
    destinationWarehouseId: string,
    finalDeliveryLat: number,
    finalDeliveryLng: number,
    finalDeliveryAddress: string,
    finalDeliveryWarehouseId?: string
  ) {
    // Get the parent order
    const parentOrder = await prisma.order.findUnique({
      where: { id: parentOrderId },
      include: {
        partner: true,
        logisticsProvider: true,
        currentWarehouse: true,
      },
    });

    if (!parentOrder) {
      throw new Error('Parent order not found');
    }

    // Get destination warehouse
    const destinationWarehouse = await prisma.warehouse.findUnique({
      where: { id: destinationWarehouseId },
      include: {
        partner: true,
      },
    });

    if (!destinationWarehouse) {
      throw new Error('Destination warehouse not found');
    }

    // Calculate pricing for the delivery leg (warehouse to customer)
    let pricing;
    try {
      pricing = await pricingService.calculateOrderPricing({
        partnerId: parentOrder.partnerId,
        pickupLat: destinationWarehouse.latitude,
        pickupLng: destinationWarehouse.longitude,
        dropLat: finalDeliveryLat,
        dropLng: finalDeliveryLng,
        isSurge: false,
      });
    } catch (error: any) {
      throw new Error(`Pricing calculation failed: ${error.message}`);
    }

    // Store Leg 3 cost (this is the internal cost for Leg 3)
    const leg3Cost = pricing.partnerPayment;

    // Get SLA priority based on partner category
    const slaPriority = pricingService.getSLAPriority(parentOrder.partner?.category || PartnerCategory.LOCAL_STORE);

    // Generate order ID
    const orderId = await generateId('ORD');

    // Create the delivery order
    const deliveryOrder = await prisma.order.create({
      data: {
        id: orderId,
        partnerId: parentOrder.partnerId,
        // Pickup from destination warehouse
        pickupWarehouseId: destinationWarehouseId,
        pickupLat: destinationWarehouse.latitude,
        pickupLng: destinationWarehouse.longitude,
        pickupAddressText: `${destinationWarehouse.name}, ${destinationWarehouse.address}`,
        // Drop to final customer location
        dropLat: finalDeliveryLat,
        dropLng: finalDeliveryLng,
        dropAddressText: finalDeliveryAddress,
        dropWarehouseId: finalDeliveryWarehouseId || null,
        // Pricing
        payoutAmount: pricing.agentPayout,
        orderAmount: pricing.partnerPayment,
        partnerPayment: pricing.partnerPayment,
        agentPayout: pricing.agentPayout,
        adminCommission: pricing.adminCommission,
        partnerCategory: parentOrder.partnerCategory || PartnerCategory.LOCAL_STORE,
        distanceKm: pricing.distanceKm,
        slaPriority,
        priority: parentOrder.priority || 'NORMAL',
        status: 'SEARCHING_AGENT',
        leg3Cost: Math.round(leg3Cost * 100) / 100, // Store Leg 3 cost for billing
        // Copy customer data from parent order (critical for e-commerce)
        customerName: parentOrder.customerName || undefined,
        customerPhone: parentOrder.customerPhone || undefined,
        customerEmail: parentOrder.customerEmail || undefined,
        customerAddress: parentOrder.customerAddress || undefined,
        productType: parentOrder.productType || undefined,
        // Copy barcode/QR code from parent order (same physical label)
        barcode: parentOrder.barcode || undefined,
        qrCode: parentOrder.qrCode || undefined,
        // Copy PDF URL if available
        pdfUrl: parentOrder.pdfUrl || undefined,
        // Link to parent order for tracking
        transitLegs: {
          parentOrderId: parentOrderId,
          leg: 'FINAL_DELIVERY',
          fromWarehouse: destinationWarehouseId,
          toCustomer: true,
        } as any,
      } as any,
    });

    // Update parent order to mark that delivery order was created
    await prisma.order.update({
      where: { id: parentOrderId },
      data: {
        transitLegs: {
          ...(parentOrder.transitLegs as any || {}),
          deliveryOrderId: orderId,
          deliveryOrderCreatedAt: new Date().toISOString(),
        } as any,
      } as any,
    });

    return deliveryOrder;
  },

  /**
   * Check if order has reached destination warehouse and create delivery order if needed
   */
  async checkAndCreateDeliveryOrder(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        partner: true,
        logisticsProvider: true,
        currentWarehouse: true,
      },
    });

    if (!order) {
      return null;
    }

    // Check if this is a logistics order with transit legs
    const transitLegs = order.transitLegs as any;
    if (!transitLegs || !Array.isArray(transitLegs)) {
      return null; // Not a logistics order
    }

    // Find leg 3 (DESTINATION_WAREHOUSE to DELIVERY)
    const leg3 = transitLegs.find((leg: any) => leg.leg === 3);
    if (!leg3) {
      return null; // No leg 3 found
    }

    // Check if order has reached destination warehouse
    const hasReachedDestination =
      order.status === OrderStatus.AT_WAREHOUSE ||
      order.status === OrderStatus.READY_FOR_PICKUP;

    // Check if current warehouse is the destination warehouse
    const isAtDestinationWarehouse =
      order.currentWarehouseId === leg3.warehouseId ||
      order.currentWarehouseId === leg3.destinationWarehouseId;

    // Check if delivery order already created
    const deliveryOrderAlreadyCreated = transitLegs.some(
      (leg: any) => leg.deliveryOrderId
    );

    if (
      hasReachedDestination &&
      isAtDestinationWarehouse &&
      !deliveryOrderAlreadyCreated &&
      leg3.finalDeliveryLat &&
      leg3.finalDeliveryLng
    ) {
      // Use transaction to prevent race condition
      try {
        return await prisma.$transaction(async (tx) => {
          // Double-check delivery order not created (within transaction)
          const currentOrder = await tx.order.findUnique({
            where: { id: orderId },
            select: { transitLegs: true },
          });

          const currentTransitLegs = currentOrder?.transitLegs as any;
          if (currentTransitLegs?.deliveryOrderId) {
            console.log(`[Logistics Order] Delivery order already created for ${orderId}`);
            return null; // Already created by another process
          }

          // Create delivery order
          return await this.createDeliveryOrderFromWarehouse(
            orderId,
            leg3.warehouseId || leg3.destinationWarehouseId,
            leg3.finalDeliveryLat,
            leg3.finalDeliveryLng,
            leg3.finalDeliveryAddress || 'Customer Address',
            leg3.finalDeliveryWarehouseId
          );
        });
      } catch (error: any) {
        console.error(`[Logistics Order] Failed to create delivery order for ${orderId}:`, error.message);
        return null;
      }
    }

    return null;
  },

  /**
   * Case 3 & 4: Create RTO (Return to Origin) order
   * Used when:
   * - Case 3: Customer cancels after Leg 2 (order at destination warehouse)
   * - Case 4: Leg 3 delivery fails (customer unavailable, etc.)
   * 
   * RTO Flow:
   * - Reverse Leg 2: Destination Warehouse → Origin Warehouse (via logistics provider)
   * - Reverse Leg 1: Origin Warehouse → Seller (via regular agent)
   * - Do NOT reopen Leg 2 - create new reverse logistics order
   */
  async createRTOOrder(
    parentOrderId: string,
    reason: string,
    currentWarehouseId: string
  ) {
    const parentOrder = await prisma.order.findUnique({
      where: { id: parentOrderId },
      include: {
        partner: true,
        logisticsProvider: true,
        originWarehouse: true,
        currentWarehouse: true,
      },
    });

    if (!parentOrder) {
      throw new Error('Parent order not found');
    }

    if (!parentOrder.originWarehouseId) {
      throw new Error('Parent order does not have origin warehouse for RTO');
    }

    const originWarehouse = parentOrder.originWarehouse;
    if (!originWarehouse) {
      throw new Error('Origin warehouse not found');
    }

    const currentWarehouse = await prisma.warehouse.findUnique({
      where: { id: currentWarehouseId },
    });

    if (!currentWarehouse) {
      throw new Error('Current warehouse not found');
    }

    // Check if RTO order already exists
    const existingRTO = await prisma.order.findFirst({
      where: {
        transitLegs: {
          path: ['rtoParentOrderId'],
          equals: parentOrderId,
        } as any,
        status: {
          not: 'CANCELLED',
        },
      },
    });

    if (existingRTO) {
      console.log(`[RTO] RTO order already exists for ${parentOrderId}: ${existingRTO.id}`);
      return existingRTO;
    }

    // Get seller location from original order (Leg 1 pickup location)
    // This should be stored in transitLegs or we use the original pickup location
    const transitLegs = parentOrder.transitLegs as any;
    const leg1 = Array.isArray(transitLegs) ? transitLegs.find((leg: any) => leg.leg === 1) : null;
    
    // Seller location is the original pickup location (Leg 1 start)
    const sellerLat = parentOrder.pickupLat; // Original pickup from seller
    const sellerLng = parentOrder.pickupLng;
    const sellerAddress = parentOrder.pickupAddressText || 'Seller Location';

    // Generate RTO order ID
    const rtoOrderId = await generateId('RTO');

    // Create RTO order - reverse Leg 2 (destination → origin warehouse via logistics provider)
    const rtoOrder = await prisma.order.create({
      data: {
        id: rtoOrderId,
        partnerId: parentOrder.partnerId,
        logisticsProviderId: parentOrder.logisticsProviderId || undefined,
        // Pickup from current warehouse (destination)
        pickupWarehouseId: currentWarehouseId,
        pickupLat: currentWarehouse.latitude,
        pickupLng: currentWarehouse.longitude,
        pickupAddressText: `${currentWarehouse.name}, ${currentWarehouse.address}`,
        // Drop to origin warehouse
        dropWarehouseId: parentOrder.originWarehouseId,
        dropLat: originWarehouse.latitude,
        dropLng: originWarehouse.longitude,
        dropAddressText: `${originWarehouse.name}, ${originWarehouse.address}`,
        originWarehouseId: parentOrder.originWarehouseId,
        currentWarehouseId: currentWarehouseId,
        status: OrderStatus.IN_TRANSIT, // Start in IN_TRANSIT for logistics provider
        priority: parentOrder.priority || 'NORMAL',
        partnerCategory: parentOrder.partnerCategory || PartnerCategory.LOCAL_STORE,
        // Copy product info for tracking
        productType: parentOrder.productType || undefined,
        barcode: parentOrder.barcode || undefined,
        qrCode: parentOrder.qrCode || undefined,
        // RTO metadata
        transitLegs: {
          rtoParentOrderId: parentOrderId,
          rtoReason: reason,
          rtoCreatedAt: new Date().toISOString(),
          leg: 'RTO_REVERSE_LEG2',
          fromWarehouse: currentWarehouseId,
          toWarehouse: parentOrder.originWarehouseId,
          // After this completes, will need reverse Leg 1 (origin → seller)
          sellerLat,
          sellerLng,
          sellerAddress,
        } as any,
        // Pricing will be handled by logistics provider
        payoutAmount: 0,
        partnerPayment: 0,
      } as any,
    });

    // Update parent order to mark RTO created
    await prisma.order.update({
      where: { id: parentOrderId },
      data: {
        transitLegs: {
          ...(transitLegs || {}),
          rtoOrderId: rtoOrderId,
          rtoCreatedAt: new Date().toISOString(),
          rtoReason: reason,
        } as any,
      } as any,
    });

    console.log(`[RTO] Created RTO order ${rtoOrderId} for parent ${parentOrderId}`);
    return rtoOrder;
  },

  /**
   * Create reverse Leg 1 RTO order (origin warehouse → seller)
   * Called when RTO reverse Leg 2 completes (order arrives at origin warehouse)
   */
  async createRTOReverseLeg1(
    rtoOrderId: string,
    originWarehouseId: string
  ) {
    const rtoOrder = await prisma.order.findUnique({
      where: { id: rtoOrderId },
      include: {
        partner: true,
        originWarehouse: true,
      },
    });

    if (!rtoOrder) {
      throw new Error('RTO order not found');
    }

    const transitLegs = rtoOrder.transitLegs as any;
    if (!transitLegs?.sellerLat || !transitLegs?.sellerLng) {
      throw new Error('RTO order missing seller location');
    }

    const originWarehouse = await prisma.warehouse.findUnique({
      where: { id: originWarehouseId },
    });

    if (!originWarehouse) {
      throw new Error('Origin warehouse not found');
    }

    // Calculate pricing for reverse Leg 1 (warehouse → seller)
    let pricing;
    try {
      pricing = await pricingService.calculateOrderPricing({
        partnerId: rtoOrder.partnerId,
        pickupLat: originWarehouse.latitude,
        pickupLng: originWarehouse.longitude,
        dropLat: transitLegs.sellerLat,
        dropLng: transitLegs.sellerLng,
        isSurge: false,
      });
    } catch (error: any) {
      throw new Error(`Pricing calculation failed: ${error.message}`);
    }

    const slaPriority = pricingService.getSLAPriority(rtoOrder.partner?.category || PartnerCategory.LOCAL_STORE);
    const reverseLeg1OrderId = await generateId('RTO');

    // Create reverse Leg 1 order (origin warehouse → seller)
    const reverseLeg1Order = await prisma.order.create({
      data: {
        id: reverseLeg1OrderId,
        partnerId: rtoOrder.partnerId,
        // Pickup from origin warehouse
        pickupWarehouseId: originWarehouseId,
        pickupLat: originWarehouse.latitude,
        pickupLng: originWarehouse.longitude,
        pickupAddressText: `${originWarehouse.name}, ${originWarehouse.address}`,
        // Drop to seller
        dropLat: transitLegs.sellerLat,
        dropLng: transitLegs.sellerLng,
        dropAddressText: transitLegs.sellerAddress || 'Seller Location',
        // Pricing
        payoutAmount: pricing.agentPayout,
        partnerPayment: pricing.partnerPayment,
        agentPayout: pricing.agentPayout,
        adminCommission: pricing.adminCommission,
        partnerCategory: rtoOrder.partnerCategory || PartnerCategory.LOCAL_STORE,
        distanceKm: pricing.distanceKm,
        slaPriority,
        priority: rtoOrder.priority || 'NORMAL',
        status: 'SEARCHING_AGENT',
        // Copy product info
        productType: rtoOrder.productType || undefined,
        barcode: rtoOrder.barcode || undefined,
        qrCode: rtoOrder.qrCode || undefined,
        // Link to RTO order
        transitLegs: {
          rtoOrderId: rtoOrderId,
          leg: 'RTO_REVERSE_LEG1',
          fromWarehouse: originWarehouseId,
          toSeller: true,
        } as any,
      } as any,
    });

    // Update RTO order to mark reverse Leg 1 created
    await prisma.order.update({
      where: { id: rtoOrderId },
      data: {
        transitLegs: {
          ...transitLegs,
          reverseLeg1OrderId: reverseLeg1OrderId,
          reverseLeg1CreatedAt: new Date().toISOString(),
        } as any,
      } as any,
    });

    console.log(`[RTO] Created reverse Leg 1 order ${reverseLeg1OrderId} for RTO ${rtoOrderId}`);
    return reverseLeg1Order;
  },
};
























