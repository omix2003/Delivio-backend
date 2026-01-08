import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { getPartnerId, getUserId } from '../utils/role.util';
import { notifyPartner } from '../lib/webhook';
import { notifyPartnerOrderStatusUpdate, notifyAgentOrderStatusUpdate } from '../lib/websocket';
import { OrderStatus, EventType, ActorType, PartnerCategory, SLAPriority } from '@prisma/client';
import { eventService } from '../services/event.service';
import { cacheService, cacheKeys } from '../services/cache.service';
import { pricingService } from '../services/pricing.service';
import { getRedisClient, isRedisConnected } from '../lib/redis';
import path from 'path';

export const partnerController = {
  // GET /api/partner/profile
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      // Try cache first (TTL: 5 minutes)
      const cacheKey = cacheKeys.partner.profile(partnerId);
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      if (!partner) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      const response = {
        id: partner.id,
        companyName: partner.companyName,
        apiKey: partner.apiKey,
        webhookUrl: partner.webhookUrl,
        isActive: partner.isActive,
        user: partner.user,
      };

      // Cache the response
      await cacheService.set(cacheKey, response, 300); // 5 minutes

      res.json(response);
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/partner/webhook
  async updateWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { webhookUrl } = req.body;

      const partner = await prisma.partner.update({
        where: { id: partnerId },
        data: { webhookUrl },
      });

      // Invalidate cache
      await cacheService.invalidate(cacheKeys.partner.profile(partnerId));

      res.json({
        id: partner.id,
        webhookUrl: partner.webhookUrl,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/partner/regenerate-api-key
  async regenerateApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      // Generate new API key using the same format as registration
      const newApiKey = `pk_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const partner = await prisma.partner.update({
        where: { id: partnerId },
        data: { apiKey: newApiKey },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      // Log API key regeneration event
      eventService.logPartnerEvent(
        EventType.ORDER_CREATED, // We'll need to add a new event type, but using existing for now
        partnerId,
        partner.user.id,
        { action: 'API_KEY_REGENERATED' }
      );

      // Invalidate cache
      await cacheService.invalidate(cacheKeys.partner.profile(partnerId));

      res.json({
        id: partner.id,
        apiKey: partner.apiKey,
        message: 'API key regenerated successfully. Please update your integrations with the new key.',
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/partner/orders - Create order
  async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      // Verify partner is active
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
      });

      if (!partner) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      if (!partner.isActive) {
        return res.status(403).json({ error: 'Partner account is not active' });
      }

      const {
        pickupLat,
        pickupLng,
        dropLat,
        dropLng,
        pickupWarehouseId,
        pickupRestaurantId,
        dropWarehouseId,
        originWarehouseId, // For multi-leg logistics flow
        currentWarehouseId, // For multi-leg logistics flow
        logisticsProviderId, // For multi-leg logistics flow
        transitLegs, // For multi-leg logistics flow
        pickupAddressText,
        dropAddressText,
        customerName,
        customerPhone,
        customerEmail,
        customerAddress,
        productType,
        payoutAmount, // Optional - will be calculated if not provided
        orderAmount, // Optional - will be calculated if not provided
        paymentType = 'PREPAID', // PREPAID or COD
        orderType = 'ON_DEMAND', // ON_DEMAND or B2B_BULK
        commissionRate, // Optional custom commission rate (not used with pricing profiles)
        priority = 'NORMAL',
        estimatedDuration,
        pickupWindow, // Scheduled pickup time (for E-commerce)
        isSurge = false, // Whether surge pricing applies
      } = req.body;

      // Extract coordinates from warehouses/restaurants if IDs are provided
      let finalPickupLat = pickupLat;
      let finalPickupLng = pickupLng;
      let finalDropLat = dropLat;
      let finalDropLng = dropLng;

      // Get pickup coordinates from warehouse or restaurant if provided
      if (pickupWarehouseId && (!finalPickupLat || !finalPickupLng)) {
        const warehouse = await prisma.warehouse.findUnique({
          where: { id: pickupWarehouseId },
          select: { latitude: true, longitude: true },
        });
        if (warehouse) {
          finalPickupLat = warehouse.latitude;
          finalPickupLng = warehouse.longitude;
        }
      }

      if (pickupRestaurantId && (!finalPickupLat || !finalPickupLng)) {
        const restaurant = await prisma.restaurant.findUnique({
          where: { id: pickupRestaurantId },
          select: { latitude: true, longitude: true },
        });
        if (restaurant) {
          finalPickupLat = restaurant.latitude;
          finalPickupLng = restaurant.longitude;
        }
      }

      // Get drop coordinates from warehouse if provided
      if (dropWarehouseId && (!finalDropLat || !finalDropLng)) {
        const warehouse = await prisma.warehouse.findUnique({
          where: { id: dropWarehouseId },
          select: { latitude: true, longitude: true },
        });
        if (warehouse) {
          finalDropLat = warehouse.latitude;
          finalDropLng = warehouse.longitude;
        }
      }

      // Validate that we have all required coordinates
      if (!finalPickupLat || !finalPickupLng || !finalDropLat || !finalDropLng) {
        return res.status(400).json({ 
          error: 'Pickup and drop coordinates are required. Provide either coordinates directly or warehouse/restaurant IDs.' 
        });
      }

      // Calculate pricing using pricing service (category-aware)
      // Check wallet balance for LOCAL_STORE partners (wallet-based billing)
      try {
        const { partnerWalletService } = await import('../services/partner-wallet.service');
        const walletCheck = await partnerWalletService.canCreateOrder(partnerId, orderAmount || 0);
        if (!walletCheck.allowed) {
          return res.status(400).json({
            error: walletCheck.reason || 'Insufficient wallet balance',
            walletBalance: walletCheck.currentBalance,
            requiredBalance: walletCheck.requiredBalance,
          });
        }
      } catch (walletError: any) {
        // If wallet service fails, log but don't block order creation (might not be wallet-based)
        console.warn('[Partner Controller] Wallet check failed:', walletError?.message);
      }

      let pricing;
      let pricingProfile;
      try {
        pricingProfile = await pricingService.getPricingProfile(partnerId);
        pricing = await pricingService.calculateOrderPricing({
          partnerId,
          pickupLat: finalPickupLat,
          pickupLng: finalPickupLng,
          dropLat: finalDropLat,
          dropLng: finalDropLng,
          isSurge,
        });
      } catch (error: any) {
        return res.status(400).json({ 
          error: `Pricing calculation failed: ${error.message}` 
        });
      }

      // Use provided amounts if given, otherwise use calculated pricing
      const finalPartnerPayment = orderAmount || pricing.partnerPayment;
      const finalPayoutAmount = payoutAmount || pricing.agentPayout;
      const finalAdminCommission = pricing.adminCommission;

      // Get SLA priority based on partner category
      const slaPriority = pricingService.getSLAPriority(partner.category);

      // For Quick Commerce, default priority to HIGH if not specified
      const finalPriority = partner.category === PartnerCategory.QUICK_COMMERCE && priority === 'NORMAL' 
        ? 'HIGH' 
        : priority;

      // LOCAL_STORE partners cannot use multi-leg logistics flow
      // They have a single shop location (stored in partner.address, city, pincode)
      if (partner.category === PartnerCategory.LOCAL_STORE) {
        if (originWarehouseId || currentWarehouseId || logisticsProviderId || transitLegs) {
          return res.status(400).json({
            error: 'Multi-leg logistics flow is not available for LOCAL_STORE partners',
            message: 'Local stores use direct delivery from shop to customer. Please use shop address as pickup location.',
          });
        }
        
        // For LOCAL_STORE, pickup should be from partner's shop address
        // If pickup coordinates are not provided, use partner's address if available
        if (!finalPickupLat || !finalPickupLng) {
          if (partner.address && partner.city) {
            // In a real implementation, you'd geocode the address here
            // For now, we'll require coordinates to be provided
            return res.status(400).json({
              error: 'Pickup coordinates are required',
              message: 'Please provide pickup coordinates. For local stores, this should be your shop location.',
            });
          }
        }
      }

      // Validate multi-leg logistics flow: ensure origin and destination warehouses are different
      // (Only for non-LOCAL_STORE partners)
      if (partner.category !== PartnerCategory.LOCAL_STORE && transitLegs && Array.isArray(transitLegs) && originWarehouseId) {
        // Extract destination warehouse from transit legs
        const leg2 = transitLegs.find((leg: any) => leg.leg === 2);
        const leg3 = transitLegs.find((leg: any) => leg.leg === 3);
        
        let destinationWarehouseId: string | null = null;
        if (leg2 && leg2.destinationWarehouseId) {
          destinationWarehouseId = leg2.destinationWarehouseId;
        } else if (leg3 && leg3.warehouseId) {
          destinationWarehouseId = leg3.warehouseId;
        }
        
        // Validate that origin and destination are different
        if (destinationWarehouseId && originWarehouseId === destinationWarehouseId) {
          return res.status(400).json({ 
            error: 'Origin warehouse and destination warehouse cannot be the same. Please select different warehouses for origin and destination.' 
          });
        }
        
        // Also validate that if currentWarehouseId is set, it's not the same as destination
        if (currentWarehouseId && destinationWarehouseId && currentWarehouseId === destinationWarehouseId && originWarehouseId === currentWarehouseId) {
          return res.status(400).json({ 
            error: 'Origin warehouse and destination warehouse cannot be the same. Please select different warehouses.' 
          });
        }
      }

      // Generate order ID
      const { generateId } = await import('../utils/id-generator.util');
      const orderId = await generateId('ORD');

      // Debug: Log logisticsProviderId if provided
      if (logisticsProviderId) {
        console.log('[Partner Controller] Creating order with logisticsProviderId:', logisticsProviderId);
      }

      // Create order first (barcode/QR will be generated after)
      // Try with all fields first, fallback to basic fields if columns don't exist
      let order;
      try {
        order = await prisma.order.create({
          data: {
            id: orderId,
            partnerId,
            pickupLat: finalPickupLat,
            pickupLng: finalPickupLng,
            dropLat: finalDropLat,
            dropLng: finalDropLng,
            pickupWarehouseId: pickupWarehouseId || undefined,
            pickupRestaurantId: pickupRestaurantId || undefined,
            dropWarehouseId: dropWarehouseId || undefined,
            originWarehouseId: originWarehouseId || undefined, // For multi-leg logistics flow
            currentWarehouseId: currentWarehouseId || undefined, // For multi-leg logistics flow
            logisticsProviderId: logisticsProviderId || undefined, // For multi-leg logistics flow
            payoutAmount: finalPayoutAmount,
            partnerPayment: finalPartnerPayment,
            agentPayout: finalPayoutAmount,
            adminCommission: finalAdminCommission,
            partnerCategory: partner.category,
            distanceKm: pricing.distanceKm,
            slaPriority,
            pickupWindow: pickupWindow ? new Date(pickupWindow) : null,
            orderType: orderType as 'ON_DEMAND' | 'B2B_BULK',
            commissionRate: typeof pricingProfile.agentSharePct === 'number' ? (100 - pricingProfile.agentSharePct) : 30,
            priority: finalPriority,
            estimatedDuration,
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
            customerEmail: customerEmail || undefined,
            customerAddress: customerAddress || undefined,
            productType: productType || undefined,
            orderAmount: finalPartnerPayment, // Always set orderAmount (validated above)
            paymentType: paymentType || 'PREPAID',
            transitLegs: transitLegs ? (Array.isArray(transitLegs) ? transitLegs : undefined) : undefined, // For multi-leg logistics flow
            status: 'SEARCHING_AGENT',
          },
          select: {
            id: true,
            status: true,
            pickupLat: true,
            pickupLng: true,
            dropLat: true,
            dropLng: true,
            payoutAmount: true,
            priority: true,
            estimatedDuration: true,
            createdAt: true,
            partner: {
              select: {
                id: true,
                user: {
                  select: {
                    name: true,
                    id: true,
                  },
                },
              },
            },
          },
        });
      } catch (createError: any) {
        // If columns don't exist (P2021/P2022), create order without them
        if (createError?.code === 'P2021' || createError?.code === 'P2022' || 
            createError?.message?.includes('orderAmount') || 
            createError?.message?.includes('commissionRate') ||
            createError?.message?.includes('orderType') ||
            createError?.message?.includes('does not exist')) {
          console.warn('[Partner] Order columns missing, creating order without revenue fields:', createError.message);
          
          // Try creating with minimal fields - catch any additional missing column errors
          try {
            order = await prisma.order.create({
              data: {
                id: orderId,
                partnerId,
                pickupLat: finalPickupLat,
                pickupLng: finalPickupLng,
                dropLat: finalDropLat,
                dropLng: finalDropLng,
                pickupWarehouseId: pickupWarehouseId || undefined,
                pickupRestaurantId: pickupRestaurantId || undefined,
                dropWarehouseId: dropWarehouseId || undefined,
                originWarehouseId: originWarehouseId || undefined, // For multi-leg logistics flow
                currentWarehouseId: currentWarehouseId || undefined, // For multi-leg logistics flow
                logisticsProviderId: logisticsProviderId || undefined, // For multi-leg logistics flow
                payoutAmount: finalPayoutAmount,
                priority: finalPriority,
                estimatedDuration,
                customerName: customerName || undefined,
                customerPhone: customerPhone || undefined,
                customerEmail: customerEmail || undefined,
                customerAddress: customerAddress || undefined,
                productType: productType || undefined,
                orderAmount: orderAmount || undefined,
                paymentType: paymentType || 'PREPAID',
                status: 'SEARCHING_AGENT',
              },
              select: {
                id: true,
                status: true,
                pickupLat: true,
                pickupLng: true,
                dropLat: true,
                dropLng: true,
                payoutAmount: true,
                priority: true,
                estimatedDuration: true,
                createdAt: true,
                partner: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                        id: true,
                      },
                    },
                  },
                },
              },
            });
          } catch (fallbackError: any) {
            // If even basic fields fail, try with absolute minimum
            if (fallbackError?.code === 'P2021' || fallbackError?.code === 'P2022' || 
                fallbackError?.message?.includes('does not exist')) {
              console.warn('[Partner] Additional columns missing, trying absolute minimum fields:', fallbackError.message);
              order = await prisma.order.create({
                data: {
                  id: orderId,
                  partnerId,
                  pickupLat: finalPickupLat,
                  pickupLng: finalPickupLng,
                  dropLat: finalDropLat,
                  dropLng: finalDropLng,
                  pickupWarehouseId: pickupWarehouseId || undefined,
                  pickupRestaurantId: pickupRestaurantId || undefined,
                  dropWarehouseId: dropWarehouseId || undefined,
                  originWarehouseId: originWarehouseId || undefined, // For multi-leg logistics flow
                  currentWarehouseId: currentWarehouseId || undefined, // For multi-leg logistics flow
                  logisticsProviderId: logisticsProviderId || undefined, // For multi-leg logistics flow
                  transitLegs: transitLegs ? (Array.isArray(transitLegs) ? transitLegs : undefined) : undefined, // For multi-leg logistics flow
                  payoutAmount: finalPayoutAmount,
                  customerName: customerName || undefined,
                  customerPhone: customerPhone || undefined,
                  customerEmail: customerEmail || undefined,
                  customerAddress: customerAddress || undefined,
                  productType: productType || undefined,
                  orderAmount: orderAmount || undefined,
                  paymentType: paymentType || 'PREPAID',
                  status: 'SEARCHING_AGENT',
                },
                select: {
                  id: true,
                  status: true,
                  pickupLat: true,
                  pickupLng: true,
                  dropLat: true,
                  dropLng: true,
                  payoutAmount: true,
                  createdAt: true,
                  partner: {
                    select: {
                      id: true,
                      user: {
                        select: {
                          name: true,
                          id: true,
                        },
                      },
                    },
                  },
                },
              });
            } else {
              // Re-throw if it's a different error
              throw fallbackError;
            }
          }
        } else {
          // Re-throw if it's a different error
          throw createError;
        }
      }

      // Generate and assign barcode/QR code after order creation
      try {
        const { barcodeService } = await import('../services/barcode.service');
        await barcodeService.assignBarcodeToOrder(order.id);
      } catch (error: any) {
        // Log but don't fail if barcode service has issues
        console.warn('[Partner] Barcode service error:', error.message);
      }

      // Generate PDF if customer details are provided
      let pdfUrl: string | undefined;
      if (customerName && customerPhone && (customerAddress || dropAddressText)) {
        try {
          const { pdfService } = await import('../services/pdf.service');
          
          // Get addresses - use provided text or format coordinates
          let pickupAddr = pickupAddressText;
          if (!pickupAddr && pickupWarehouseId) {
            const warehouse = await prisma.warehouse.findUnique({ 
              where: { id: pickupWarehouseId }, 
              select: { address: true, name: true } 
            });
            pickupAddr = warehouse ? `${warehouse.name}, ${warehouse.address}` : null;
          }
          if (!pickupAddr && pickupRestaurantId) {
            const restaurant = await prisma.restaurant.findUnique({ 
              where: { id: pickupRestaurantId }, 
              select: { address: true, name: true } 
            });
            pickupAddr = restaurant ? `${restaurant.name}, ${restaurant.address}` : null;
          }
          if (!pickupAddr) {
            pickupAddr = `${finalPickupLat.toFixed(6)}, ${finalPickupLng.toFixed(6)}`;
          }
          
          let dropAddr = dropAddressText || customerAddress;
          if (!dropAddr && dropWarehouseId) {
            const warehouse = await prisma.warehouse.findUnique({ 
              where: { id: dropWarehouseId }, 
              select: { address: true, name: true } 
            });
            dropAddr = warehouse ? `${warehouse.name}, ${warehouse.address}` : null;
          }
          if (!dropAddr) {
            dropAddr = `${finalDropLat.toFixed(6)}, ${finalDropLng.toFixed(6)}`;
          }

          // Get barcode from order
          const orderWithBarcode = await prisma.order.findUnique({
            where: { id: order.id },
            select: { barcode: true },
          });

          const pdfPath = await pdfService.generateShippingLabel({
            orderId: order.id,
            partnerName: partner.companyName,
            customerName,
            customerPhone,
            customerEmail: customerEmail || undefined,
            customerAddress: customerAddress || dropAddr,
            productType: productType || undefined,
            pickupAddress: pickupAddr,
            dropAddress: dropAddr,
            orderAmount: orderAmount || finalPartnerPayment,
            paymentType: paymentType || 'PREPAID',
            priority: finalPriority,
            estimatedDuration: estimatedDuration || undefined,
            distanceKm: pricing.distanceKm,
            createdAt: order.createdAt,
            barcode: orderWithBarcode?.barcode || undefined,
          });

          // PDF path is already in format /uploads/pdfs/filename.pdf
          pdfUrl = pdfPath;

          // Update order with PDF URL
          await prisma.order.update({
            where: { id: order.id },
            data: { pdfUrl },
          });
        } catch (error: any) {
          // Log but don't fail if PDF generation has issues
          console.warn('[Partner] PDF generation error:', error.message);
        }
      }

      // Fetch updated order (using select to avoid non-existent columns)
      const orderWithBarcode = await prisma.order.findUnique({
        where: { id: order.id },
        select: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          priority: true,
          estimatedDuration: true,
          pdfUrl: true,
          createdAt: true,
          partner: {
            select: {
              id: true,
              user: {
                select: {
                  name: true,
                  id: true,
                },
              },
            },
          },
        },
      });

      // Log order creation event
      eventService.logOrderEvent(
        EventType.ORDER_CREATED,
        orderWithBarcode!.id,
        ActorType.PARTNER,
        orderWithBarcode!.partner.user.id,
        {
          partnerId,
          payoutAmount,
          priority,
          estimatedDuration,
        }
      );

      // Trigger order assignment engine (Phase 5)
      // This will find nearby agents and offer the order to them
      // Assignment happens when an agent accepts the order
      const { assignOrder } = await import('../services/assignment.service');
      const finalOrder = orderWithBarcode || order;
      assignOrder({
        orderId: finalOrder.id,
        pickupLat: finalOrder.pickupLat,
        pickupLng: finalOrder.pickupLng,
        payoutAmount: finalOrder.payoutAmount,
        priority: ((finalOrder as any).priority as 'HIGH' | 'NORMAL' | 'LOW') || 'NORMAL',
        maxRadius: 5000, // 5km
        maxAgentsToOffer: 5,
        offerTimeout: 30, // 30 seconds
      })
        .then((result) => {
        })
        .catch((error) => {
          // Log error but don't fail order creation
          console.error('[Partner] Failed to trigger assignment engine:', error);
        });

      // Notify partner via webhook (optional - for confirmation)
      await notifyPartner(
        partnerId,
        'ORDER_CREATED',
        finalOrder.id,
        finalOrder.status,
        {
          trackingNumber: finalOrder.id.substring(0, 8).toUpperCase(),
          payout: finalOrder.payoutAmount,
        }
      );

      res.status(201).json({
        id: finalOrder.id,
        trackingNumber: order.id.substring(0, 8).toUpperCase(),
        status: order.status,
        pickup: {
          latitude: order.pickupLat,
          longitude: order.pickupLng,
        },
        dropoff: {
          latitude: order.dropLat,
          longitude: order.dropLng,
        },
        payout: order.payoutAmount,
        priority: (order as any).priority || 'NORMAL',
        estimatedDuration: (order as any).estimatedDuration || null,
        pdfUrl: orderWithBarcode?.pdfUrl || undefined,
        createdAt: order.createdAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/partner/orders - List all partner orders
  async getOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { status, limit = 50, offset = 0 } = req.query;

      const where: any = { partnerId };
      if (status) {
        // Handle both single status and array of statuses
        if (Array.isArray(status)) {
          where.status = {
            in: status
              .filter((s): s is string => typeof s === 'string')
              .map((s) => s as OrderStatus),
          };
        } else if (typeof status === 'string') {
          where.status = status as OrderStatus;
        }
      }

      // Optimize query by using select instead of include
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          select: {
            id: true,
            status: true,
            pickupLat: true,
            pickupLng: true,
            dropLat: true,
            dropLng: true,
            payoutAmount: true,
            priority: true,
            estimatedDuration: true,
            assignedAt: true,
            pickedUpAt: true,
            deliveredAt: true,
            cancelledAt: true,
            cancellationReason: true,
            createdAt: true,
            agent: {
              select: {
                id: true,
                vehicleType: true,
                user: {
                  select: {
                    name: true,
                    phone: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: Number(limit),
          skip: Number(offset),
        }),
        prisma.order.count({ where }),
      ]);

      // Calculate timing information for each order
      const { delayCheckerService } = await import('../services/delay-checker.service');
      
      res.json({
        orders: orders.map(order => {
          const timing = delayCheckerService.getOrderTiming({
            pickedUpAt: order.pickedUpAt,
            estimatedDuration: order.estimatedDuration,
          });
          
          return {
            id: order.id,
            trackingNumber: order.id.substring(0, 8).toUpperCase(),
            status: order.status,
            pickup: {
              latitude: order.pickupLat,
              longitude: order.pickupLng,
            },
            dropoff: {
              latitude: order.dropLat,
              longitude: order.dropLng,
            },
            payout: order.payoutAmount,
            priority: order.priority,
            estimatedDuration: order.estimatedDuration,
            assignedAt: order.assignedAt?.toISOString(),
            pickedUpAt: order.pickedUpAt?.toISOString(),
            deliveredAt: order.deliveredAt?.toISOString(),
            cancelledAt: order.cancelledAt?.toISOString(),
            cancellationReason: order.cancellationReason,
            createdAt: order.createdAt.toISOString(),
            timing: {
              elapsedMinutes: timing.elapsedMinutes,
              remainingMinutes: timing.remainingMinutes,
              isDelayed: timing.isDelayed,
              elapsedTime: timing.elapsedTime,
              remainingTime: timing.remainingTime,
            },
            agent: order.agent ? {
              id: order.agent.id,
              name: order.agent.user.name,
              phone: order.agent.user.phone,
              vehicleType: order.agent.vehicleType,
            } : null,
          };
        }),
        total,
        limit: Number(limit),
        offset: Number(offset),
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/partner/orders/:id/agent-location - Get agent location for an order
  async getOrderAgentLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const orderId = req.params.id;

      // Verify order belongs to partner
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          partnerId,
        },
        select: {
          id: true,
          agentId: true,
          agent: {
            select: {
              id: true,
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      if (!order.agentId) {
        return res.json({
          agentId: null,
          location: null,
          hasLocation: false,
        });
      }

      // Get agent location from Redis GEO
      let location = null;
      if (isRedisConnected()) {
        const client = getRedisClient();
        if (client) {
          const position = await client.geopos('agents_locations', order.agentId);
          if (position && position.length > 0 && position[0]) {
            const [lonStr, latStr] = position[0] as [string | null, string | null];
            if (lonStr && latStr) {
              const longitude = parseFloat(lonStr);
              const latitude = parseFloat(latStr);
              if (!isNaN(longitude) && !isNaN(latitude)) {
                location = { longitude, latitude };
              }
            }
          }
        }
      }

      // If no Redis location, try to get last known location from database
      if (!location) {
        const lastLocation = await prisma.agentLocation.findFirst({
          where: { agentId: order.agentId },
          orderBy: { timestamp: 'desc' },
          select: {
            latitude: true,
            longitude: true,
            timestamp: true,
          },
        });

        if (lastLocation) {
          location = {
            longitude: lastLocation.longitude,
            latitude: lastLocation.latitude,
          };
        }
      }

      res.json({
        agentId: order.agentId,
        agentName: order.agent?.user?.name || null,
        location,
        hasLocation: !!location,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/partner/orders/:id - Get order details
  async getOrderDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const orderId = req.params.id;

      // Try to include barcode and qrCode in the main query
      let order: any = null;
      let barcode = null;
      let qrCode = null;
      
      // Fetch order without barcode/qrCode to avoid errors if columns don't exist
      order = await prisma.order.findFirst({
        where: {
          id: orderId,
          partnerId, // Ensure partner owns this order
        },
        select: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          priority: true,
          estimatedDuration: true,
          actualDuration: true,
          assignedAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          cancelledAt: true,
          cancellationReason: true,
          pdfUrl: true,
          createdAt: true,
          updatedAt: true,
          agent: {
            select: {
              id: true,
              vehicleType: true,
              rating: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
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

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Check and update delayed status
      try {
        const { delayCheckerService } = await import('../services/delay-checker.service');
        await delayCheckerService.checkOrderDelay(orderId);
      } catch (error: any) {
        // Log but don't fail if delay checker service has issues
        console.warn('[Partner] Delay checker service error:', error.message);
      }
      
      // Refresh order to get updated status (using select to avoid non-existent columns)
      let refreshedOrder = null;
      try {
        refreshedOrder = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            pickedUpAt: true,
            estimatedDuration: true,
          },
        });
      } catch (error: any) {
        console.warn('[Partner] Error refreshing order:', error.message);
      }
      
      // Calculate timing information
      let timing = {
        elapsedMinutes: 0,
        remainingMinutes: 0,
        isDelayed: false,
        elapsedTime: '0m',
        remainingTime: '0m',
      };
      try {
        const { delayCheckerService } = await import('../services/delay-checker.service');
        timing = delayCheckerService.getOrderTiming({
          pickedUpAt: refreshedOrder?.pickedUpAt || order.pickedUpAt,
          estimatedDuration: refreshedOrder?.estimatedDuration || order.estimatedDuration,
        });
      } catch (error: any) {
        console.warn('[Partner] Error calculating timing:', error.message);
      }

      // Try to get barcode/qrCode only if columns exist (check via raw query first)
      // Check if barcode column exists before trying to fetch
      try {
        await prisma.$queryRaw`SELECT "barcode" FROM "Order" LIMIT 1`;
        // Column exists, try to fetch barcode/qrCode
        try {
          const orderWithCodes = await prisma.$queryRaw<Array<{ barcode: string | null; qrCode: string | null }>>`
            SELECT "barcode", "qrCode" FROM "Order" WHERE "id" = ${orderId} LIMIT 1
          `;
          if (orderWithCodes && orderWithCodes.length > 0) {
            barcode = orderWithCodes[0].barcode;
            qrCode = orderWithCodes[0].qrCode;
          }
        } catch (fetchError: any) {
          // Failed to fetch, that's okay
          console.warn('[Partner] Could not fetch barcode/qrCode:', fetchError.message);
        }
      } catch (checkError: any) {
        // Column doesn't exist, skip barcode/qrCode entirely
        console.warn('[Partner] Barcode/QR code columns do not exist in database. Migration may need to run.');
        barcode = null;
        qrCode = null;
      }
      
      // If barcode/qrCode are null and columns exist, try to generate them
      if (order && barcode === null && qrCode === null) {
        try {
          // Check again if columns exist before trying to generate
          await prisma.$queryRaw`SELECT "barcode" FROM "Order" LIMIT 1`;
          const { barcodeService } = await import('../services/barcode.service');
          await barcodeService.assignBarcodeToOrder(order.id);
          // Fetch again after assignment using raw query
          try {
            const orderWithCodes = await prisma.$queryRaw<Array<{ barcode: string | null; qrCode: string | null }>>`
              SELECT "barcode", "qrCode" FROM "Order" WHERE "id" = ${orderId} LIMIT 1
            `;
            if (orderWithCodes && orderWithCodes.length > 0) {
              barcode = orderWithCodes[0].barcode;
              qrCode = orderWithCodes[0].qrCode;
            }
          } catch (fetchError: any) {
            // Failed to fetch after generation, that's okay
            console.warn('[Partner] Could not fetch barcode/qrCode after generation:', fetchError.message);
          }
        } catch (error: any) {
          // Columns don't exist or generation failed, that's okay
          if (error.message?.includes('does not exist') || error.code === 'P2021' || error.code === 'P2022') {
            console.warn('[Partner] Barcode/QR code columns do not exist. Skipping generation.');
          } else {
            console.warn('[Partner] Could not generate barcode/qrCode:', error.message);
          }
        }
      }

      res.json({
        id: order.id,
        trackingNumber: order.id.substring(0, 8).toUpperCase(),
        status: refreshedOrder?.status || order.status,
        pickup: {
          latitude: order.pickupLat,
          longitude: order.pickupLng,
        },
        dropoff: {
          latitude: order.dropLat,
          longitude: order.dropLng,
        },
        payout: order.payoutAmount,
        priority: order.priority,
        estimatedDuration: order.estimatedDuration,
        actualDuration: order.actualDuration,
        assignedAt: order.assignedAt?.toISOString(),
        pickedUpAt: order.pickedUpAt?.toISOString(),
        deliveredAt: order.deliveredAt?.toISOString(),
        cancelledAt: order.cancelledAt?.toISOString(),
        cancellationReason: order.cancellationReason,
        pdfUrl: order.pdfUrl || undefined,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        barcode: barcode,
        qrCode: qrCode,
        timing: {
          elapsedMinutes: timing.elapsedMinutes,
          remainingMinutes: timing.remainingMinutes,
          isDelayed: timing.isDelayed,
          elapsedTime: timing.elapsedTime,
          remainingTime: timing.remainingTime,
        },
        agent: order.agent ? {
          id: order.agent.id,
          name: order.agent.user.name,
          email: order.agent.user.email,
          phone: order.agent.user.phone,
          vehicleType: order.agent.vehicleType,
          rating: order.agent.rating,
        } : null,
        partner: {
          id: order.partner.id,
          companyName: order.partner.companyName,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/partner-api/orders - Create order (external API with API key)
  async createOrderExternal(req: Request, res: Response, next: NextFunction) {
    try {
      // Partner info is attached by authenticateApiKey middleware
      const partner = req.partner;
      if (!partner) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get partner details to check category
      const partnerDetails = await prisma.partner.findUnique({
        where: { id: partner.partnerId },
      });

      if (!partnerDetails) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      const {
        pickupLat,
        pickupLng,
        dropLat,
        dropLng,
        payoutAmount, // Optional - will be calculated if not provided
        orderAmount, // Optional - will be calculated if not provided
        orderType = 'ON_DEMAND', // ON_DEMAND or B2B_BULK
        commissionRate, // Optional custom commission rate (not used with pricing profiles)
        priority = 'NORMAL',
        estimatedDuration,
        pickupWindow, // Scheduled pickup time (for E-commerce)
        isSurge = false, // Whether surge pricing applies
      } = req.body;

      // Calculate pricing using pricing service (category-aware)
      let pricing;
      let pricingProfile;
      try {
        pricingProfile = await pricingService.getPricingProfile(partner.partnerId);
        pricing = await pricingService.calculateOrderPricing({
          partnerId: partner.partnerId,
          pickupLat,
          pickupLng,
          dropLat,
          dropLng,
          isSurge,
        });
      } catch (error: any) {
        return res.status(400).json({ 
          error: `Pricing calculation failed: ${error.message}` 
        });
      }

      // Use provided amounts if given, otherwise use calculated pricing
      const finalPartnerPayment = orderAmount || pricing.partnerPayment;
      const finalPayoutAmount = payoutAmount || pricing.agentPayout;
      const finalAdminCommission = pricing.adminCommission;

      // Validate that orderAmount is set (required for revenue calculations)
      if (!finalPartnerPayment || finalPartnerPayment <= 0) {
        return res.status(400).json({
          error: 'Invalid order amount',
          message: 'orderAmount is required and must be greater than 0. Either provide orderAmount or ensure pricing calculation succeeds.',
        });
      }

      // Get SLA priority based on partner category
      const slaPriority = pricingService.getSLAPriority(partnerDetails.category);

      // For Quick Commerce, default priority to HIGH if not specified
      const finalPriority = partnerDetails.category === PartnerCategory.QUICK_COMMERCE && priority === 'NORMAL' 
        ? 'HIGH' 
        : priority;

      // Generate order ID
      const { generateId } = await import('../utils/id-generator.util');
      const orderId = await generateId('ORD');

      // Create order first
      // Try with all fields first, fallback to basic fields if columns don't exist
      let order;
      try {
        order = await prisma.order.create({
          data: {
            id: orderId,
            partnerId: partner.partnerId,
            pickupLat,
            pickupLng,
            dropLat,
            dropLng,
            payoutAmount: finalPayoutAmount,
            orderAmount: finalPartnerPayment,
            partnerPayment: finalPartnerPayment,
            agentPayout: finalPayoutAmount,
            adminCommission: finalAdminCommission,
            partnerCategory: partnerDetails.category,
            distanceKm: pricing.distanceKm,
            slaPriority,
            pickupWindow: pickupWindow ? new Date(pickupWindow) : null,
            orderType: orderType as 'ON_DEMAND' | 'B2B_BULK',
            commissionRate: typeof pricingProfile.agentSharePct === 'number' ? (100 - pricingProfile.agentSharePct) : 30,
            priority: finalPriority,
            estimatedDuration,
            status: 'SEARCHING_AGENT',
          },
        });
      } catch (createError: any) {
        // If columns don't exist (P2021/P2022), create order without them
        if (createError?.code === 'P2021' || createError?.code === 'P2022' || 
            createError?.message?.includes('orderAmount') || 
            createError?.message?.includes('commissionRate') ||
            createError?.message?.includes('orderType')) {
          console.warn('[Partner API] Order columns missing, creating order without revenue fields:', createError.message);
          
          // Try creating with minimal fields - catch any additional missing column errors
          try {
            order = await prisma.order.create({
              data: {
                id: orderId,
                partnerId: partner.partnerId,
                pickupLat,
                pickupLng,
                dropLat,
                dropLng,
                payoutAmount,
                priority,
                estimatedDuration,
                status: 'SEARCHING_AGENT',
              },
            });
          } catch (fallbackError: any) {
            // If even basic fields fail, try with absolute minimum
            if (fallbackError?.code === 'P2021' || fallbackError?.code === 'P2022' || 
                fallbackError?.message?.includes('does not exist') ||
                fallbackError?.message?.includes('priority') ||
                fallbackError?.message?.includes('estimatedDuration')) {
              console.warn('[Partner API] Additional columns missing, trying absolute minimum fields:', fallbackError.message);
              order = await prisma.order.create({
                data: {
                  id: orderId,
                  partnerId: partner.partnerId,
                  pickupLat,
                  pickupLng,
                  dropLat,
                  dropLng,
                  payoutAmount,
                  status: 'SEARCHING_AGENT',
                },
              });
            } else {
              // Re-throw if it's a different error
              throw fallbackError;
            }
          }
        } else {
          // Re-throw if it's a different error
          throw createError;
        }
      }

      // Generate and assign barcode/QR code after order creation
      const { barcodeService } = await import('../services/barcode.service');
      await barcodeService.assignBarcodeToOrder(order.id);

      // Fetch updated order (using select to avoid barcode/qrCode if columns don't exist)
      const orderWithBarcode = await prisma.order.findUnique({
        where: { id: order.id },
        select: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          priority: true,
          estimatedDuration: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Notify partner via webhook
      await notifyPartner(
        partner.partnerId,
        'ORDER_CREATED',
        order.id,
        order.status,
        {
          trackingNumber: order.id.substring(0, 8).toUpperCase(),
          payout: order.payoutAmount,
        }
      );

      res.status(201).json({
        id: order.id,
        trackingNumber: order.id.substring(0, 8).toUpperCase(),
        status: order.status,
        pickup: {
          latitude: order.pickupLat,
          longitude: order.pickupLng,
        },
        dropoff: {
          latitude: order.dropLat,
          longitude: order.dropLng,
        },
        payout: order.payoutAmount,
        priority: order.priority,
        estimatedDuration: order.estimatedDuration,
        createdAt: order.createdAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/partner-api/orders/:id - Get order details (external API with API key)
  async getOrderDetailsExternal(req: Request, res: Response, next: NextFunction) {
    try {
      const partner = req.partner;
      if (!partner) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const orderId = req.params.id;

      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          partnerId: partner.partnerId, // Ensure partner owns this order
        },
        select: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          priority: true,
          estimatedDuration: true,
          actualDuration: true,
          assignedAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          cancelledAt: true,
          cancellationReason: true,
          createdAt: true,
          updatedAt: true,
          agent: {
            select: {
              id: true,
              vehicleType: true,
              rating: true,
              user: {
                select: {
                  name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      res.json({
        id: order.id,
        trackingNumber: order.id.substring(0, 8).toUpperCase(),
        status: order.status,
        pickup: {
          latitude: order.pickupLat,
          longitude: order.pickupLng,
        },
        dropoff: {
          latitude: order.dropLat,
          longitude: order.dropLng,
        },
        payout: order.payoutAmount,
        priority: order.priority,
        estimatedDuration: order.estimatedDuration,
        actualDuration: order.actualDuration,
        assignedAt: order.assignedAt?.toISOString(),
        pickedUpAt: order.pickedUpAt?.toISOString(),
        deliveredAt: order.deliveredAt?.toISOString(),
        cancelledAt: order.cancelledAt?.toISOString(),
        cancellationReason: order.cancellationReason,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        agent: order.agent ? {
          name: order.agent.user.name,
          phone: order.agent.user.phone,
          vehicleType: order.agent.vehicleType,
        } : null,
      });
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/partner/orders/:id - Update order details
  async updateOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const orderId = req.params.id;
      const {
        pickupLat,
        pickupLng,
        dropLat,
        dropLng,
        payoutAmount,
        priority,
        estimatedDuration,
      } = req.body;

      // Find the order and verify ownership (using select to avoid barcode/qrCode)
      const existingOrder = await prisma.order.findFirst({
        where: {
          id: orderId,
          partnerId, // Ensure partner owns this order
        },
        select: {
          id: true,
          status: true,
          partnerId: true,
        },
      });

      if (!existingOrder) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Only allow editing if order is still searching for an agent (not assigned yet)
      if (existingOrder.status !== 'SEARCHING_AGENT') {
        return res.status(403).json({ 
          error: 'Cannot edit order. Order has already been assigned to an agent.' 
        });
      }

      // Build update data with only provided fields
      const updateData: any = {};
      if (pickupLat !== undefined) updateData.pickupLat = pickupLat;
      if (pickupLng !== undefined) updateData.pickupLng = pickupLng;
      if (dropLat !== undefined) updateData.dropLat = dropLat;
      if (dropLng !== undefined) updateData.dropLng = dropLng;
      if (payoutAmount !== undefined) updateData.payoutAmount = payoutAmount;
      if (priority !== undefined) updateData.priority = priority;
      if (estimatedDuration !== undefined) updateData.estimatedDuration = estimatedDuration;

      // Update the order
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: updateData,
        select: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          priority: true,
          estimatedDuration: true,
          createdAt: true,
          updatedAt: true,
          partner: {
            select: {
              id: true,
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      // Notify partner via webhook
      await notifyPartner(
        partnerId,
        'ORDER_UPDATED',
        updatedOrder.id,
        updatedOrder.status,
        {
          trackingNumber: updatedOrder.id.substring(0, 8).toUpperCase(),
          changes: Object.keys(updateData),
        }
      );

      res.json({
        id: updatedOrder.id,
        trackingNumber: updatedOrder.id.substring(0, 8).toUpperCase(),
        status: updatedOrder.status,
        pickup: {
          latitude: updatedOrder.pickupLat,
          longitude: updatedOrder.pickupLng,
        },
        dropoff: {
          latitude: updatedOrder.dropLat,
          longitude: updatedOrder.dropLng,
        },
        payout: updatedOrder.payoutAmount,
        priority: updatedOrder.priority,
        estimatedDuration: updatedOrder.estimatedDuration,
        createdAt: updatedOrder.createdAt.toISOString(),
        updatedAt: updatedOrder.updatedAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/partner/dashboard - Get partner dashboard KPIs
  async getDashboardMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      // Try cache first (TTL: 2 minutes - dashboard data changes frequently)
      const cacheKey = cacheKeys.partner.dashboard(partnerId);
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const [
        todayOrders,
        thisMonthOrders,
        lastMonthOrders,
        activeOrders,
        cancelledOrders,
        totalCompletedOrders,
      ] = await Promise.all([
        // Today's orders
        prisma.order.count({
          where: {
            partnerId,
            createdAt: { gte: todayStart },
          },
        }),
        // This month's orders
        prisma.order.count({
          where: {
            partnerId,
            createdAt: { gte: thisMonthStart },
          },
        }),
        // Last month's orders (for comparison)
        prisma.order.count({
          where: {
            partnerId,
            createdAt: {
              gte: lastMonthStart,
              lte: lastMonthEnd,
            },
          },
        }),
        // Active orders (searching, assigned, picked up, out for delivery)
        prisma.order.count({
          where: {
            partnerId,
            status: {
              in: [
                OrderStatus.SEARCHING_AGENT,
                OrderStatus.ASSIGNED,
                OrderStatus.PICKED_UP,
                OrderStatus.OUT_FOR_DELIVERY,
              ],
            },
          },
        }),
        // Cancelled orders (delivery issues)
        prisma.order.count({
          where: {
            partnerId,
            status: OrderStatus.CANCELLED,
            cancelledAt: { gte: todayStart },
          },
        }),
        // Total completed orders
        prisma.order.count({
          where: {
            partnerId,
            status: OrderStatus.DELIVERED,
          },
        }),
      ]);

      // Calculate trends
      const monthlyTrend = lastMonthOrders > 0
        ? ((thisMonthOrders - lastMonthOrders) / lastMonthOrders) * 100
        : 0;

      const response = {
        todayOrders,
        monthlyOrders: thisMonthOrders,
        monthlyTrend: Math.round(monthlyTrend),
        activeOrders,
        deliveryIssues: cancelledOrders,
        totalDeliveries: totalCompletedOrders,
      };

      // Cache the response (2 minutes TTL)
      await cacheService.set(cacheKey, response, 120);

      res.json(response);
    } catch (error) {
      next(error);
    }
  },

  // GET /api/partner/analytics/heatmap - Get order locations for heatmap
  async getOrderHeatmap(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { startDate, endDate } = req.query;
      
      // Default to last 30 days if not specified
      const start = startDate 
        ? new Date(startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate 
        ? new Date(endDate as string)
        : new Date();

      // Get order locations (pickup and dropoff points)
      const orders = await prisma.order.findMany({
        where: {
          partnerId,
          createdAt: { gte: start, lte: end },
        },
        select: {
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          status: true,
          createdAt: true,
        },
      });

      // Format data for heatmap: [lng, lat, intensity]
      const heatmapData = orders.flatMap((order) => [
        {
          location: [order.pickupLng, order.pickupLat] as [number, number],
          type: 'pickup' as const,
          status: order.status,
          date: order.createdAt.toISOString(),
        },
        {
          location: [order.dropLng, order.dropLat] as [number, number],
          type: 'dropoff' as const,
          status: order.status,
          date: order.createdAt.toISOString(),
        },
      ]);

      res.json({
        data: heatmapData,
        bounds: orders.length > 0 ? {
          minLng: Math.min(...orders.map(o => Math.min(o.pickupLng, o.dropLng))),
          maxLng: Math.max(...orders.map(o => Math.max(o.pickupLng, o.dropLng))),
          minLat: Math.min(...orders.map(o => Math.min(o.pickupLat, o.dropLat))),
          maxLat: Math.max(...orders.map(o => Math.max(o.pickupLat, o.dropLat))),
        } : null,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/partner/analytics - Get partner analytics
  async getAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { startDate, endDate } = req.query;
      
      // Default to last 30 days if not specified
      const start = startDate 
        ? new Date(startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate 
        ? new Date(endDate as string)
        : new Date();

      // Get order statistics
      const [
        totalOrders,
        completedOrders,
        cancelledOrders,
        activeOrders,
        totalPayout,
        ordersByStatus,
        ordersByDay,
        avgDeliveryTime,
      ] = await Promise.all([
        // Total orders
        prisma.order.count({
          where: {
            partnerId,
            createdAt: { gte: start, lte: end },
          },
        }),
        // Completed orders
        prisma.order.count({
          where: {
            partnerId,
            status: 'DELIVERED',
            deliveredAt: { gte: start, lte: end },
          },
        }),
        // Cancelled orders
        prisma.order.count({
          where: {
            partnerId,
            status: 'CANCELLED',
            cancelledAt: { gte: start, lte: end },
          },
        }),
        // Active orders
        prisma.order.count({
          where: {
            partnerId,
            status: {
              in: [
                OrderStatus.SEARCHING_AGENT,
                OrderStatus.ASSIGNED,
                OrderStatus.PICKED_UP,
                OrderStatus.OUT_FOR_DELIVERY,
              ],
            },
          },
        }),
        // Total payout
        prisma.order.aggregate({
          where: {
            partnerId,
            status: 'DELIVERED',
            deliveredAt: { gte: start, lte: end },
          },
          _sum: {
            payoutAmount: true,
          },
        }),
        // Orders by status
        prisma.order.groupBy({
          by: ['status'],
          where: {
            partnerId,
            createdAt: { gte: start, lte: end },
          },
          _count: {
            id: true,
          },
        }),
        // Orders by day - fetch all orders and group in JavaScript
        prisma.order.findMany({
          where: {
            partnerId,
            createdAt: { gte: start, lte: end },
          },
          select: {
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        }),
        // Average delivery time
        prisma.order.aggregate({
          where: {
            partnerId,
            status: 'DELIVERED',
            deliveredAt: { gte: start, lte: end },
            actualDuration: { not: null },
          },
          _avg: {
            actualDuration: true,
          },
        }),
      ]);

      // Format orders by day - group by date
      const ordersByDate = new Map<string, number>();
      ordersByDay.forEach((order: any) => {
        const dateKey = order.createdAt.toISOString().split('T')[0];
        ordersByDate.set(dateKey, (ordersByDate.get(dateKey) || 0) + 1);
      });
      
      const dailyOrders = Array.from(ordersByDate.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 30); // Limit to 30 days

      // Format orders by status
      const statusBreakdown = ordersByStatus.reduce((acc: any, item: any) => {
        acc[item.status] = item._count.id;
        return acc;
      }, {});

      res.json({
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
        summary: {
          totalOrders,
          completedOrders,
          cancelledOrders,
          activeOrders,
          totalPayout: totalPayout._sum.payoutAmount || 0,
          avgDeliveryTime: avgDeliveryTime._avg.actualDuration || 0,
          completionRate: totalOrders > 0 
            ? ((completedOrders / totalOrders) * 100).toFixed(1)
            : '0',
          cancellationRate: totalOrders > 0
            ? ((cancelledOrders / totalOrders) * 100).toFixed(1)
            : '0',
        },
        breakdown: {
          byStatus: statusBreakdown,
          byDay: dailyOrders,
        },
      });
    } catch (error: any) {
      console.error('[Partner Analytics] Error:', error);
      console.error('[Partner Analytics] Error details:', {
        message: error.message,
        stack: error.stack,
      });
      next(error);
    }
  },

  // GET /api/partner/support/tickets - Get partner's support tickets
  async getSupportTickets(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getUserId(req);
      const partnerId = getPartnerId(req);
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { status, page = '1', limit = '20' } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {
        userId,
        ...(partnerId ? { partnerId } : {}),
      };

      if (status && status !== 'ALL') {
        where.status = status;
      }

      let tickets: any[] = [];
      let total = 0;

      try {
        [tickets, total] = await Promise.all([
          prisma.supportTicket.findMany({
            where,
            select: {
              id: true,
              issueType: true,
              description: true,
              status: true,
              resolvedAt: true,
              createdAt: true,
              updatedAt: true,
              order: {
                select: {
                  id: true,
                  status: true,
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            skip,
            take: limitNum,
          }),
          prisma.supportTicket.count({ where }),
        ]);
      } catch (error: any) {
        // Handle missing SupportTicket table
        if (error.code === 'P2021' || error.code === '42P01' || error.message?.includes('does not exist')) {
          console.warn('[Partner] SupportTicket table does not exist, returning empty results');
          return res.json({
            tickets: [],
            pagination: {
              page: pageNum,
              limit: limitNum,
              total: 0,
              totalPages: 0,
            },
          });
        }
        throw error;
      }

      res.json({
        tickets: tickets.map((ticket: any) => ({
          id: ticket.id,
          issueType: ticket.issueType,
          description: ticket.description,
          status: ticket.status,
          resolvedAt: ticket.resolvedAt,
          createdAt: ticket.createdAt.toISOString(),
          updatedAt: ticket.updatedAt.toISOString(),
          order: ticket.order || null,
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/partner/support/tickets - Create support ticket
  async createSupportTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getUserId(req);
      const partnerId = getPartnerId(req);
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { orderId, issueType, description } = req.body;

      if (!issueType || !description) {
        return res.status(400).json({ error: 'Issue type and description are required' });
      }

      if (!['DELAY', 'MISSING', 'DAMAGE', 'OTHER'].includes(issueType)) {
        return res.status(400).json({ error: 'Invalid issue type' });
      }

      // Verify order exists and belongs to partner if orderId is provided
      if (orderId) {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            partnerId: true,
          },
        });

        if (!order) {
          return res.status(404).json({ error: 'Order not found' });
        }

        if (order.partnerId !== partnerId) {
          return res.status(403).json({ error: 'You can only create tickets for your own orders' });
        }
      }

      const ticket = await prisma.supportTicket.create({
        data: {
          userId,
          partnerId: partnerId || null,
          orderId: orderId || null,
          issueType,
          description,
          status: 'OPEN',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          order: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      res.status(201).json({
        id: ticket.id,
        issueType: ticket.issueType,
        description: ticket.description,
        status: ticket.status,
        createdAt: ticket.createdAt.toISOString(),
        message: 'Support ticket created successfully',
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/partner/orders/bulk - Create bulk orders (E-commerce only)
  async createBulkOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      // Verify partner is active and is E-commerce
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
      });

      if (!partner) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      if (!partner.isActive) {
        return res.status(403).json({ error: 'Partner account is not active' });
      }

      // Only E-commerce partners can create bulk orders
      if (partner.category !== PartnerCategory.ECOMMERCE) {
        return res.status(403).json({ 
          error: 'Bulk orders are only available for E-commerce partners' 
        });
      }

      const { orders } = req.body;

      if (!Array.isArray(orders) || orders.length === 0) {
        return res.status(400).json({ error: 'Orders array is required and must not be empty' });
      }

      if (orders.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 orders per bulk request' });
      }

      const { generateId } = await import('../utils/id-generator.util');
      
      // Get pricing profile once (partner doesn't change in bulk orders)
      let pricingProfile;
      try {
        pricingProfile = await pricingService.getPricingProfile(partnerId);
      } catch (error: any) {
        return res.status(400).json({ 
          error: `Failed to get pricing profile: ${error.message}` 
        });
      }

      const createdOrders = [];

      for (const orderData of orders) {
        const {
          pickupLat,
          pickupLng,
          dropLat,
          dropLng,
          payoutAmount,
          orderAmount,
          priority = 'NORMAL',
          estimatedDuration,
          pickupWindow,
          isSurge = false,
        } = orderData;

        // Calculate pricing
        let pricing;
        try {
          pricing = await pricingService.calculateOrderPricing({
            partnerId,
            pickupLat,
            pickupLng,
            dropLat,
            dropLng,
            isSurge,
          });
        } catch (error: any) {
          console.error(`[Bulk Orders] Pricing calculation failed for order:`, error.message);
          continue; // Skip this order
        }

        const finalPartnerPayment = orderAmount || pricing.partnerPayment;
        const finalPayoutAmount = payoutAmount || pricing.agentPayout;
        const finalAdminCommission = pricing.adminCommission;
        const slaPriority = pricingService.getSLAPriority(partner.category);

        // Validate that orderAmount is set (required for revenue calculations)
        if (!finalPartnerPayment || finalPartnerPayment <= 0) {
          console.error(`[Bulk Orders] Invalid order amount for order, skipping:`, { orderAmount, calculatedAmount: pricing.partnerPayment });
          continue; // Skip this order
        }

        const orderId = await generateId('ORD');

        try {
          const order = await prisma.order.create({
            data: {
              id: orderId,
              partnerId,
              pickupLat,
              pickupLng,
              dropLat,
              dropLng,
              payoutAmount: finalPayoutAmount,
              orderAmount: finalPartnerPayment,
              partnerPayment: finalPartnerPayment,
              agentPayout: finalPayoutAmount,
              adminCommission: finalAdminCommission,
            partnerCategory: partner.category,
            distanceKm: pricing.distanceKm,
            slaPriority,
            pickupWindow: pickupWindow ? new Date(pickupWindow) : null,
            orderType: 'ON_DEMAND',
            commissionRate: typeof pricingProfile.agentSharePct === 'number' ? (100 - pricingProfile.agentSharePct) : 30,
            priority,
            estimatedDuration,
            status: 'SEARCHING_AGENT',
          },
        });

          // Generate barcode/QR code
          try {
            const { barcodeService } = await import('../services/barcode.service');
            await barcodeService.assignBarcodeToOrder(order.id);
          } catch (error: any) {
            console.warn(`[Bulk Orders] Barcode generation failed for order ${order.id}:`, error.message);
          }

          // Trigger assignment
          const { assignOrder } = await import('../services/assignment.service');
          assignOrder({
            orderId: order.id,
            pickupLat: order.pickupLat,
            pickupLng: order.pickupLng,
            payoutAmount: order.payoutAmount,
            priority: (order.priority as 'HIGH' | 'NORMAL' | 'LOW') || 'NORMAL',
            maxRadius: 5000,
            maxAgentsToOffer: 5,
            offerTimeout: 30,
          }).catch((error) => {
            console.error(`[Bulk Orders] Assignment failed for order ${order.id}:`, error);
          });

          createdOrders.push({
            id: order.id,
            trackingNumber: order.id.substring(0, 8).toUpperCase(),
            status: order.status,
          });
        } catch (error: any) {
          console.error(`[Bulk Orders] Failed to create order:`, error.message);
          // Continue with next order
        }
      }

      res.status(201).json({
        message: `Created ${createdOrders.length} out of ${orders.length} orders`,
        orders: createdOrders,
        total: createdOrders.length,
      });
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/partners/:id/pricing - Update partner pricing profile
  async updatePricingProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = req.params.id || getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      // Check if partner exists
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
      });

      if (!partner) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      const { pricingProfileId } = req.body;

      // Validate pricingProfileId if provided
      if (pricingProfileId !== undefined && pricingProfileId !== null) {
        const profileExists = await prisma.pricingProfile.findUnique({
          where: { id: pricingProfileId },
        });
        
        if (!profileExists) {
          return res.status(404).json({ error: 'Pricing profile not found' });
        }
      }

      // If pricingProfileId is null/undefined, remove custom pricing (use category default)
      const updatedPartner = await prisma.partner.update({
        where: { id: partnerId },
        data: {
          pricingProfileId: pricingProfileId !== undefined ? pricingProfileId : null,
        },
        include: {
          pricingProfile: true,
        },
      });

      // Invalidate cache
      await cacheService.invalidate(cacheKeys.partner.profile(partnerId));

      res.json({
        id: updatedPartner.id,
        pricingProfileId: updatedPartner.pricingProfileId,
        pricingProfile: updatedPartner.pricingProfile,
        message: 'Pricing profile updated successfully',
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/partner/orders/:id/cancel - Cancel an order
  async cancelOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const orderId = req.params.id;
      const { reason } = req.body;

      const order = await prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findFirst({
          where: {
            id: orderId,
            partnerId, // Ensure partner owns this order
          },
          select: {
            id: true,
            status: true,
            partnerId: true,
            agentId: true,
            logisticsAgentId: true,
            logisticsProviderId: true,
            currentWarehouseId: true,
            originWarehouseId: true,
            transitLegs: true,
          },
        });

        if (!currentOrder) {
          throw new Error('Order not found or you do not have permission to cancel it');
        }

        // Don't allow cancellation if already delivered or cancelled
        if (currentOrder.status === 'DELIVERED') {
          throw new Error('Cannot cancel an order that has already been delivered');
        }

        if (currentOrder.status === 'CANCELLED') {
          throw new Error('Order is already cancelled');
        }

        // EDGE CASE 3: Customer cancels after Leg 2 (order at destination warehouse)
        // Convert to RTO flow - reverse logistics via provider
        const transitLegs = currentOrder.transitLegs as any;
        const leg2 = Array.isArray(transitLegs) ? transitLegs.find((leg: any) => leg.leg === 2) : null;
        const isAfterLeg2 = leg2 && leg2.status === 'COMPLETED' && 
                           (currentOrder.status === 'AT_WAREHOUSE' || 
                            currentOrder.status === 'READY_FOR_PICKUP' || 
                            currentOrder.status === 'SEARCHING_AGENT' ||
                            currentOrder.status === 'ASSIGNED' ||
                            currentOrder.status === 'PICKED_UP' ||
                            currentOrder.status === 'OUT_FOR_DELIVERY');

        if (isAfterLeg2 && currentOrder.currentWarehouseId && currentOrder.logisticsProviderId) {
          // Create RTO order - reverse logistics via provider
          try {
            const { logisticsOrderService } = await import('../services/logistics-order.service');
            await logisticsOrderService.createRTOOrder(
              orderId,
              reason || 'Cancelled by customer after Leg 2',
              currentOrder.currentWarehouseId
            );
            console.log(`[Partner Controller] Created RTO order for cancelled order ${orderId} after Leg 2`);
          } catch (error: any) {
            console.error(`[Partner Controller] Failed to create RTO order:`, error);
            // Continue with cancellation even if RTO creation fails
          }
        }

        // If order is assigned to a regular agent, free the agent
        if (currentOrder.agentId) {
          await tx.agent.update({
            where: { id: currentOrder.agentId },
            data: {
              currentOrderId: null,
              status: 'ONLINE',
            },
          });
        }

        // If order is assigned to a logistics agent, free the logistics agent
        if (currentOrder.logisticsAgentId) {
          await tx.logisticsAgent.update({
            where: { id: currentOrder.logisticsAgentId },
            data: {
              currentOrders: {
                decrement: 1,
              },
            },
          });
        }

        // Cancel the order
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: reason || 'Cancelled by partner',
          },
          select: {
            id: true,
            status: true,
            partnerId: true,
            agentId: true,
            cancelledAt: true,
            cancellationReason: true,
          },
        });

        return updatedOrder;
      });

      // Notify partner via webhook
      const { notifyPartner } = await import('../lib/webhook');
      await notifyPartner(
        order.partnerId,
        'ORDER_CANCELLED',
        orderId,
        'CANCELLED',
        {
          reason: reason || 'Cancelled by partner',
        }
      ).catch((err) => {
        console.error('[Partner] Failed to send cancellation webhook:', err);
      });

      // Notify partner via WebSocket for real-time updates
      await notifyPartnerOrderStatusUpdate(
        order.partnerId,
        {
          id: order.id,
          status: 'CANCELLED',
          cancelledAt: order.cancelledAt?.toISOString(),
          cancellationReason: order.cancellationReason,
        }
      );

      // Notify agent via WebSocket if order was assigned to an agent
      if (order.agentId) {
        await notifyAgentOrderStatusUpdate(
          order.agentId,
          {
            id: order.id,
            status: 'CANCELLED',
            cancelledAt: order.cancelledAt?.toISOString(),
            cancellationReason: order.cancellationReason,
          }
        );
      }

      res.json({
        message: 'Order cancelled successfully',
        order,
      });
    } catch (error: any) {
      if (error.message === 'Order not found or you do not have permission to cancel it' ||
          error.message === 'Cannot cancel an order that has already been delivered' ||
          error.message === 'Order is already cancelled') {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  },

  // GET /api/partner/logistics-providers - Get list of active logistics providers
  async getLogisticsProviders(req: Request, res: Response, next: NextFunction) {
    try {
      // Get all active logistics providers
      const logisticsProviders = await prisma.logisticsProvider.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          companyName: true,
          businessName: true,
          apiKey: true,
          webhookUrl: true,
          isActive: true,
          city: true,
          state: true,
        },
        orderBy: {
          companyName: 'asc',
        },
      });

      // Transform to match PartnerProfile interface for compatibility
      const providers = logisticsProviders.map((lp) => ({
        id: lp.id,
        companyName: lp.companyName,
        businessName: lp.businessName || undefined,
        category: 'LOGISTICS_PROVIDER' as const,
        apiKey: lp.apiKey,
        webhookUrl: lp.webhookUrl || undefined,
        isActive: lp.isActive,
        source: 'LOGISTICS_PROVIDER' as const,
      }));

      res.json(providers);
    } catch (error) {
      next(error);
    }
  },

  // DELETE /api/partner/orders/bulk - Delete multiple orders (partner can only delete their own orders)
  async deleteBulkOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { orderIds } = req.body;

      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: 'orderIds must be a non-empty array' });
      }

      // Verify all orders exist and belong to this partner
      const orders = await prisma.order.findMany({
        where: {
          id: { in: orderIds },
          partnerId, // Only orders belonging to this partner
        },
        select: {
          id: true,
          agentId: true,
          logisticsAgentId: true,
          status: true,
          partnerId: true,
        },
      });

      if (orders.length !== orderIds.length) {
        const foundIds = orders.map((o) => o.id);
        const missingIds = orderIds.filter((id: string) => !foundIds.includes(id));
        return res.status(404).json({
          error: `Some orders not found or you don't have permission to delete them: ${missingIds.join(', ')}`,
        });
      }

      // Only allow deletion of orders that are:
      // 1. In SEARCHING_AGENT status (not yet assigned), OR
      // 2. In READY_FOR_PICKUP status (for multi-leg orders, not yet assigned to agent), OR
      // 3. In PENDING status (not yet processed)
      // AND not assigned to an agent (agentId is null)
      const deletableStatuses = ['SEARCHING_AGENT', 'READY_FOR_PICKUP', 'PENDING'];
      const nonDeletableOrders = orders.filter((o) => {
        const hasDeletableStatus = deletableStatuses.includes(o.status);
        const isNotAssigned = !o.agentId;
        // Order is deletable if it has a deletable status AND is not assigned
        return !(hasDeletableStatus && isNotAssigned);
      });
      
      if (nonDeletableOrders.length > 0) {
        const errorDetails = nonDeletableOrders.map((o) => ({
          id: o.id,
          status: o.status,
          agentId: o.agentId,
          reason: o.agentId 
            ? 'Order is assigned to an agent' 
            : !deletableStatuses.includes(o.status)
            ? `Order status '${o.status}' is not deletable`
            : 'Unknown reason'
        }));
        
        return res.status(403).json({
          error: `Cannot delete orders that have been assigned or are in progress.`,
          details: errorDetails,
          deletableStatuses: deletableStatuses,
        });
      }

      // Delete orders and free agents in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Get all unique agent IDs that need to be freed
        const agentIdsToFree = [...new Set(orders.map((o) => o.agentId).filter(Boolean))];

        // Free agents
        if (agentIdsToFree.length > 0) {
          await tx.agent.updateMany({
            where: {
              id: { in: agentIdsToFree as string[] },
            },
            data: {
              currentOrderId: null,
              status: 'ONLINE',
            },
          });
        }

        // Delete orders
        const deleteResult = await tx.order.deleteMany({
          where: {
            id: { in: orderIds },
            partnerId, // Ensure we only delete orders belonging to this partner
          },
        });

        return deleteResult;
      });

      res.json({
        message: `Successfully deleted ${result.count} order(s)`,
        deletedCount: result.count,
      });
    } catch (error: any) {
      console.error('[Partner] Error deleting bulk orders:', error);
      next(error);
    }
  },
};

