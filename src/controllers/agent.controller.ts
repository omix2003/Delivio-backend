import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { getAgentId, getUserId, isAdmin } from '../utils/role.util';
import { redisGeo } from '../lib/redis';
import { notifyPartner } from '../lib/webhook';
import { notifyPartnerOrderStatusUpdate, notifyAgentOrderStatusUpdate } from '../lib/websocket';
import { EventType, ActorType, OrderStatus, PartnerCategory } from '@prisma/client';
import { eventService } from '../services/event.service';
import { logger } from '../lib/logger';
import path from 'path';
import fs from 'fs';

export const agentController = {
  // GET /api/agent/profile
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          documents: {
            orderBy: {
              uploadedAt: 'desc',
            },
          },
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json({
        id: agent.id,
        status: agent.status,
        vehicleType: agent.vehicleType,
        payoutPlan: agent.payoutPlan || 'WEEKLY',
        city: agent.city,
        state: agent.state,
        pincode: agent.pincode,
        isApproved: agent.isApproved,
        rating: agent.rating,
        totalOrders: agent.totalOrders,
        completedOrders: agent.completedOrders,
        acceptanceRate: agent.acceptanceRate,
        user: agent.user,
        documents: agent.documents.map(doc => ({
          id: doc.id,
          documentType: doc.documentType,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          verified: doc.verified,
          uploadedAt: doc.uploadedAt.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/agent/profile
  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const { city, state, pincode, vehicleType, payoutPlan } = req.body;

      // If payout plan is being changed, update wallet's next payout date
      let updateData: any = {
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(pincode !== undefined && { pincode }),
        ...(vehicleType && { vehicleType }),
        ...(payoutPlan && { payoutPlan }),
      };

      // If payout plan is changing, update wallet's next payout date
      if (payoutPlan) {
        const { walletService } = await import('../services/wallet.service');
        const wallet = await walletService.getAgentWallet(agentId);
        
        // Get the helper function to calculate next payout date
        const getNextPayoutDate = (plan: 'WEEKLY' | 'MONTHLY'): Date => {
          if (plan === 'MONTHLY') {
            const today = new Date();
            const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            nextMonth.setHours(0, 0, 0, 0);
            return nextMonth;
          } else {
            const today = new Date();
            const dayOfWeek = today.getDay();
            const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
            const nextMonday = new Date(today);
            nextMonday.setDate(today.getDate() + daysUntilMonday);
            nextMonday.setHours(0, 0, 0, 0);
            return nextMonday;
          }
        };

        await prisma.agentWallet.update({
          where: { agentId },
          data: {
            nextPayoutDate: getNextPayoutDate(payoutPlan),
          },
        });
      }

      // Update agent profile
      const agent = await prisma.agent.update({
        where: { id: agentId },
        data: updateData,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          documents: {
            orderBy: {
              uploadedAt: 'desc',
            },
          },
        },
      });

      // Return full profile data matching getProfile response
      res.json({
        id: agent.id,
        status: agent.status,
        vehicleType: agent.vehicleType,
        city: agent.city,
        state: agent.state,
        pincode: agent.pincode,
        isApproved: agent.isApproved,
        rating: agent.rating,
        totalOrders: agent.totalOrders,
        completedOrders: agent.completedOrders,
        acceptanceRate: agent.acceptanceRate,
        user: agent.user,
        documents: agent.documents.map(doc => ({
          id: doc.id,
          documentType: doc.documentType,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          verified: doc.verified,
          uploadedAt: doc.uploadedAt.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/agent/location
  async updateLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const { latitude, longitude } = req.body;

      // WRITE-BACK CACHE PATTERN:
      // 1. Write to Redis immediately (in-memory cache for fast queries)
      await redisGeo.addAgentLocation(agentId, longitude, latitude);

      // 2. Queue async database write (write-back pattern)
      const { locationUpdateQueue } = await import('../services/location-queue.service');
      const userId = getUserId(req);
      
      locationUpdateQueue.enqueue({
        agentId,
        latitude,
        longitude,
        timestamp: new Date(),
        userId: userId ?? undefined,
      });

      // Return immediately (don't wait for database write)
      res.json({ message: 'Location updated successfully' });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/agent/status
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, agentId: requestedAgentId } = req.body;
      
      let agentId: string;
      
      // If user is admin and provided agentId, use it; otherwise use their own agentId
      if (isAdmin(req) && requestedAgentId) {
        // Admin can update any agent's status
        agentId = requestedAgentId;
        
        // Verify the agent exists
        const agent = await prisma.agent.findUnique({
          where: { id: agentId },
        });
        
        if (!agent) {
          return res.status(404).json({ error: 'Agent not found' });
        }
      } else {
        // Agent can only update their own status
        const ownAgentId = getAgentId(req);
        if (!ownAgentId) {
          return res.status(404).json({ error: 'Agent profile not found' });
        }
        agentId = ownAgentId;
      }

      const updateData: any = { status };
      
      // Update lastOnlineAt when going online
      if (status === 'ONLINE') {
        updateData.lastOnlineAt = new Date();
      }
      
      // Remove location from Redis when going offline
      if (status === 'OFFLINE') {
        await redisGeo.removeAgentLocation(agentId);
      }

      const agent = await prisma.agent.update({
        where: { id: agentId },
        data: updateData,
        include: {
          user: {
            select: {
              id: true,
            },
          },
        },
      });

      // Log agent status change event
      const userId = agent.user.id;
      const eventType = status === 'ONLINE' ? EventType.AGENT_ONLINE : EventType.AGENT_OFFLINE;
      eventService.logAgentEvent(
        eventType,
        agentId,
        userId,
        {
          previousStatus: agent.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE',
          newStatus: status,
        }
      );

      res.json({
        id: agent.id,
        status: agent.status,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/agent/orders - Get available orders
  async getAvailableOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      // Get category filter from query params
      const { category } = req.query;

      // Get agent's current location from Redis
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          status: true,
          isApproved: true,
          currentOrderId: true,
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Only show orders if agent is online and approved
      if (agent.status !== 'ONLINE' || !agent.isApproved) {
        return res.json([]);
      }

      // Note: Location-based filtering can be added later using Redis GEO
      // For now, we return all available orders

      // Get agent's coordinates (need to get from location history or Redis GEO)
      // For now, we'll get orders within a reasonable radius
      // In a real implementation, we'd use Redis GEO to find nearby orders
      
        // Build where clause
        // Include SEARCHING_AGENT, AT_WAREHOUSE (for warehouse-to-warehouse transport), and READY_FOR_PICKUP
        // READY_FOR_PICKUP orders may have logisticsAgentId set (from previous leg), but agentId should be null
        const where: any = {
          status: {
            in: ['SEARCHING_AGENT', 'AT_WAREHOUSE', 'READY_FOR_PICKUP'],
          },
          agentId: null, // Not yet assigned to a regular delivery agent
          // Note: logisticsAgentId can be set (from logistics provider's agent), that's fine
        };

      // Filter by category if provided
      if (category && Object.values(PartnerCategory).includes(category as PartnerCategory)) {
        where.partnerCategory = category as PartnerCategory;
      }

      // Get all orders that are searching for an agent
      // Using select instead of include to avoid accessing columns that may not exist yet
      const orders = await prisma.order.findMany({
        where,
        select: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          agentPayout: true,
          partnerCategory: true,
          slaPriority: true,
          priority: true,
          estimatedDuration: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
          customerAddress: true,
          productType: true,
          orderAmount: true,
          paymentType: true,
          createdAt: true,
          partner: {
            select: {
              companyName: true,
              category: true,
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50, // Limit to 50 orders
      });

      // Format orders for response
      const formattedOrders = orders.map(order => ({
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
        agentPayout: order.agentPayout || order.payoutAmount,
        partnerCategory: order.partnerCategory || order.partner.category,
        slaPriority: order.slaPriority,
        priority: order.priority || 'NORMAL',
        estimatedDuration: order.estimatedDuration,
        customerName: order.customerName || undefined,
        customerPhone: order.customerPhone || undefined,
        customerEmail: order.customerEmail || undefined,
        customerAddress: order.customerAddress || undefined,
        productType: order.productType || undefined,
        orderAmount: order.orderAmount || undefined,
        paymentType: order.paymentType || undefined,
        createdAt: order.createdAt.toISOString(),
        partner: {
          name: order.partner.user.name,
          companyName: order.partner.companyName,
        },
      }));

      res.json(formattedOrders);
    } catch (error) {
      next(error);
    }
  },

  // POST /api/agent/orders/:id/accept - Accept an order
  async acceptOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const orderId = req.params.id;

      // Check if agent is online and approved
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          status: true,
          isApproved: true,
          currentOrderId: true,
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      if (agent.status !== 'ONLINE') {
        return res.status(400).json({ error: 'Agent must be online to accept orders' });
      }

      if (!agent.isApproved) {
        return res.status(400).json({ error: 'Agent must be approved to accept orders' });
      }

      // Check if agent has a current order and if it's in a state that allows accepting new orders
      if (agent.currentOrderId) {
        // Check the status of the current order
        const currentOrder = await prisma.order.findUnique({
          where: { id: agent.currentOrderId },
          select: { id: true, status: true },
        });

        // Allow accepting new orders if current order is in a completed/waiting state
        // (AT_WAREHOUSE means agent delivered to warehouse and is done with that leg)
        // (DELIVERED means order is fully completed)
        // (CANCELLED means order is cancelled)
        if (currentOrder && 
            currentOrder.status !== 'AT_WAREHOUSE' && 
            currentOrder.status !== 'DELIVERED' && 
            currentOrder.status !== 'CANCELLED') {
          return res.status(400).json({ 
            error: 'Agent already has an active order',
            currentOrderId: agent.currentOrderId,
            currentOrderStatus: currentOrder.status
          });
        }
        // If current order is in a completed/waiting state, clear it and allow accepting new order
        // This handles cases where currentOrderId wasn't properly cleared
        if (currentOrder) {
          await prisma.agent.update({
            where: { id: agentId },
            data: { currentOrderId: null },
          });
        }
      }

      // Check if order exists and is available
      // Use select to avoid fetching barcode/qrCode if columns don't exist yet
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          agentId: true,
          partnerId: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          priority: true,
          estimatedDuration: true,
          assignedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Allow accepting orders that are SEARCHING_AGENT, AT_WAREHOUSE, or READY_FOR_PICKUP
      if (order.status !== 'SEARCHING_AGENT' && order.status !== 'AT_WAREHOUSE' && order.status !== 'READY_FOR_PICKUP') {
        return res.status(400).json({ error: 'Order is not available for acceptance' });
      }

      if (order.agentId) {
        return res.status(400).json({ error: 'Order has already been assigned' });
      }

      // Assign order to agent (using transaction to prevent race conditions)
      const updatedOrder = await prisma.$transaction(async (tx) => {
        // Double-check order is still available
        // Use select to avoid fetching barcode/qrCode if columns don't exist yet
        const currentOrder = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            agentId: true,
            partnerId: true,
            pickupLat: true,
            pickupLng: true,
            dropLat: true,
            dropLng: true,
            payoutAmount: true,
            priority: true,
            estimatedDuration: true,
            assignedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Allow accepting orders that are SEARCHING_AGENT, AT_WAREHOUSE, or READY_FOR_PICKUP
        if (!currentOrder || currentOrder.agentId || 
            (currentOrder.status !== 'SEARCHING_AGENT' && currentOrder.status !== 'AT_WAREHOUSE' && currentOrder.status !== 'READY_FOR_PICKUP')) {
          throw new Error('Order is no longer available');
        }

        // Update order (using select to avoid barcode/qrCode if columns don't exist)
        const order = await tx.order.update({
          where: { id: orderId },
          data: {
            agentId,
            status: 'ASSIGNED',
            assignedAt: new Date(),
          },
          select: {
            id: true,
            status: true,
            agentId: true,
            partnerId: true,
            pickupLat: true,
            pickupLng: true,
            dropLat: true,
            dropLng: true,
            payoutAmount: true,
            priority: true,
            estimatedDuration: true,
            assignedAt: true,
            createdAt: true,
            updatedAt: true,
            partner: {
              select: {
                id: true,
                companyName: true,
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

        // Update agent
        await tx.agent.update({
          where: { id: agentId },
          data: {
            currentOrderId: orderId,
            status: 'ON_TRIP',
          },
        });

        return order;
      });

      // Notify partner via webhook
      await notifyPartner(
        updatedOrder.partnerId,
        'ORDER_ASSIGNED',
        updatedOrder.id,
        updatedOrder.status,
        {
          agentId,
          assignedAt: updatedOrder.assignedAt,
        }
      );

      // Log order acceptance event
      const userId = getUserId(req);
      eventService.logOrderEvent(
        EventType.ORDER_ACCEPTED,
        orderId,
        ActorType.AGENT,
        userId ?? undefined,
        {
          agentId,
          partnerId: updatedOrder.partnerId,
          payoutAmount: updatedOrder.payoutAmount,
        }
      );

      res.json({
        id: updatedOrder.id,
        status: updatedOrder.status,
        message: 'Order accepted successfully',
      });
    } catch (error: any) {
      if (error.message === 'Order is no longer available') {
        return res.status(409).json({ error: error.message });
      }
      next(error);
    }
  },

  // POST /api/agent/orders/:id/reject - Reject an order (optional - for future use)
  async rejectOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const orderId = req.params.id;
      const userId = getUserId(req);

      // Log order rejection event
      if (orderId) {
        eventService.logOrderEvent(
          EventType.ORDER_REJECTED,
          orderId,
          ActorType.AGENT,
          userId ?? undefined,
          {
            agentId,
          }
        );
      }

      // For now, rejection just means not accepting
      // In future, we might track rejection reasons
      res.json({ message: 'Order rejected' });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/agent/my-orders - Get agent's assigned/active orders
  async getMyOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const { status } = req.query;

      const where: any = {
        agentId,
      };

      // Filter by status if provided
      if (status && status !== 'ALL') {
        where.status = status;
      }
      // If status is 'ALL' or not provided, return all orders (including past/completed ones)

      // Using select instead of include to avoid accessing columns that may not exist yet
      const orders = await prisma.order.findMany({
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
          actualDuration: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
          customerAddress: true,
          productType: true,
          orderAmount: true,
          paymentType: true,
          createdAt: true,
          assignedAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          cancelledAt: true,
          cancellationReason: true,
          partner: {
            select: {
              id: true,
              companyName: true,
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
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Calculate timing information for each order
      const { delayCheckerService } = await import('../services/delay-checker.service');
      
      // Format orders for response
      const formattedOrders = orders.map(order => {
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
          priority: order.priority || 'NORMAL',
          estimatedDuration: order.estimatedDuration,
          actualDuration: order.actualDuration,
          customerName: order.customerName || undefined,
          customerPhone: order.customerPhone || undefined,
          customerEmail: order.customerEmail || undefined,
          customerAddress: order.customerAddress || undefined,
          productType: order.productType || undefined,
          createdAt: order.createdAt.toISOString(),
          assignedAt: order.assignedAt?.toISOString(),
          pickedUpAt: order.pickedUpAt?.toISOString(),
          deliveredAt: order.deliveredAt?.toISOString(),
          cancelledAt: order.cancelledAt?.toISOString(),
          cancellationReason: order.cancellationReason,
          timing: {
            elapsedMinutes: timing.elapsedMinutes,
            remainingMinutes: timing.remainingMinutes,
            isDelayed: timing.isDelayed,
            elapsedTime: timing.elapsedTime,
            remainingTime: timing.remainingTime,
          },
          partner: {
            id: order.partner.id,
            name: order.partner.user.name,
            companyName: order.partner.companyName,
            phone: order.partner.user.phone,
            email: order.partner.user.email,
          },
        };
      });

      res.json(formattedOrders);
    } catch (error) {
      next(error);
    }
  },

  // GET /api/agent/orders/:id - Get order details
  async getOrderDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const orderId = req.params.id;

      // Using select instead of include to avoid accessing columns that may not exist yet
      // Note: barcode and qrCode are not selected as they may not exist in the database
      let order: {
        id: string;
        status: any;
        agentId: string | null;
        pickupLat: number;
        pickupLng: number;
        dropLat: number;
        dropLng: number;
        payoutAmount: number;
        priority: string | null;
        estimatedDuration: number | null;
        actualDuration: number | null;
        customerName: string | null;
        customerPhone: string | null;
        customerEmail: string | null;
        customerAddress: string | null;
        productType: string | null;
        orderAmount: number | null;
        paymentType: string | null;
        createdAt: Date;
        assignedAt: Date | null;
        pickedUpAt: Date | null;
        deliveredAt: Date | null;
        cancelledAt: Date | null;
        cancellationReason: string | null;
        partner: {
          id: string;
          companyName: string;
          user: {
            name: string;
            email: string;
            phone: string;
          };
        };
      } | null;
      try {
        order = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            agentId: true,
            pickupLat: true,
            pickupLng: true,
            dropLat: true,
            dropLng: true,
            payoutAmount: true,
            priority: true,
            estimatedDuration: true,
            actualDuration: true,
            customerName: true,
            customerPhone: true,
            customerEmail: true,
            customerAddress: true,
            productType: true,
            orderAmount: true,
            paymentType: true,
            createdAt: true,
            assignedAt: true,
            pickedUpAt: true,
            deliveredAt: true,
            cancelledAt: true,
            cancellationReason: true,
            partner: {
              select: {
                id: true,
                companyName: true,
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
      } catch (error: any) {
        // If query fails due to missing columns, try without optional fields
        if (error?.code === 'P2022' || error?.message?.includes('does not exist')) {
          console.warn('⚠️  Order query failed due to missing columns, retrying with minimal fields');
          order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              status: true,
              agentId: true,
              pickupLat: true,
              pickupLng: true,
              dropLat: true,
              dropLng: true,
              payoutAmount: true,
              priority: true,
              estimatedDuration: true,
              actualDuration: true,
              customerName: true,
              customerPhone: true,
              customerEmail: true,
              customerAddress: true,
              productType: true,
              orderAmount: true,
              paymentType: true,
              createdAt: true,
              assignedAt: true,
              pickedUpAt: true,
              deliveredAt: true,
              cancelledAt: true,
              cancellationReason: true,
              partner: {
                select: {
                  id: true,
                  companyName: true,
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
        } else {
          throw error;
        }
      }

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Verify agent owns this order or it's available
      if (order.agentId && order.agentId !== agentId) {
        return res.status(403).json({ error: 'You do not have permission to view this order' });
      }

      // Check and update delayed status (with error handling)
      let refreshedOrder = null;
      let timing = {
        elapsedMinutes: 0,
        remainingMinutes: order.estimatedDuration || 0,
        isDelayed: false,
        elapsedTime: '0:00',
        remainingTime: order.estimatedDuration ? `${order.estimatedDuration}:00` : 'N/A',
      };

      try {
        const { delayCheckerService } = await import('../services/delay-checker.service');
        await delayCheckerService.checkOrderDelay(orderId);
        
        // Refresh order to get updated status (using select to avoid missing columns)
        refreshedOrder = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            pickedUpAt: true,
            estimatedDuration: true,
          },
        });
        
        // Calculate timing information
        timing = delayCheckerService.getOrderTiming({
          pickedUpAt: refreshedOrder?.pickedUpAt || order.pickedUpAt,
          estimatedDuration: refreshedOrder?.estimatedDuration || order.estimatedDuration,
        });
      } catch (delayError: any) {
        // Log error but don't fail the request
        console.error('[Agent Controller] Error checking order delay:', delayError?.message);
        // Use order data directly for timing
        if (order.pickedUpAt && order.estimatedDuration) {
          const now = new Date();
          const elapsedMs = now.getTime() - order.pickedUpAt.getTime();
          const elapsedMinutes = Math.floor(elapsedMs / 60000);
          const remainingMinutes = Math.max(0, order.estimatedDuration - elapsedMinutes);
          const isDelayed = elapsedMinutes > order.estimatedDuration;
          
          const formatTime = (minutes: number) => {
            const hrs = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}` : `${mins}:00`;
          };
          
          timing = {
            elapsedMinutes,
            remainingMinutes,
            isDelayed,
            elapsedTime: formatTime(elapsedMinutes),
            remainingTime: formatTime(remainingMinutes),
          };
        }
      }

      // Format order for response
      const formattedOrder = {
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
        priority: order.priority || 'NORMAL',
        estimatedDuration: order.estimatedDuration,
        actualDuration: order.actualDuration,
        customerName: order.customerName || undefined,
        customerPhone: order.customerPhone || undefined,
        customerEmail: order.customerEmail || undefined,
        customerAddress: order.customerAddress || undefined,
        productType: order.productType || undefined,
        orderAmount: order.orderAmount || undefined,
        paymentType: order.paymentType || undefined,
        createdAt: order.createdAt.toISOString(),
        assignedAt: order.assignedAt?.toISOString(),
        pickedUpAt: order.pickedUpAt?.toISOString(),
        deliveredAt: order.deliveredAt?.toISOString(),
        cancelledAt: order.cancelledAt?.toISOString(),
        cancellationReason: order.cancellationReason,
        // barcode and qrCode are not included as they may not exist in the database
        timing: {
          elapsedMinutes: timing.elapsedMinutes,
          remainingMinutes: timing.remainingMinutes,
          isDelayed: timing.isDelayed,
          elapsedTime: timing.elapsedTime,
          remainingTime: timing.remainingTime,
        },
        partner: {
          id: order.partner.id,
          name: order.partner.user.name,
          companyName: order.partner.companyName,
          phone: order.partner.user.phone,
          email: order.partner.user.email,
        },
      };

      res.json(formattedOrder);
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/agent/orders/:id/status - Update order status
  async updateOrderStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const orderId = req.params.id;
      const { status, cancellationReason } = req.body;

      // Verify agent owns this order
      // Use select to avoid fetching barcode/qrCode if columns don't exist yet
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          agentId: true,
          logisticsAgentId: true, // Also check logistics agent ID
          partnerId: true,
          cancellationReason: true,
          cancelledAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          payoutAmount: true,
          dropWarehouseId: true,
          dropLat: true,
          dropLng: true,
          logisticsProviderId: true,
          originWarehouseId: true,
          currentWarehouseId: true,
          transitLegs: true,
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // IMPORTANT: Regular delivery agents use agentId, logistics agents use logisticsAgentId
      // This endpoint is for regular delivery agents only
      // Logistics agents should NOT use this endpoint - they are managed by logistics providers
      
      // Prevent regular agents from updating orders assigned to logistics agents
      if (order.logisticsAgentId && !order.agentId) {
        return res.status(403).json({ 
          error: 'This order is assigned to a logistics agent. Only logistics agents can update this order.' 
        });
      }

      // Allow agents to update orders that are:
      // 1. Assigned to them (order.agentId === agentId), OR
      // 2. In READY_FOR_PICKUP or SEARCHING_AGENT status (not yet assigned, agent can pick up)
      //    BUT only if trying to update to PICKED_UP (accepting the order)
      const isOrderAssignedToAgent = order.agentId === agentId;
      const isUnassignedAndReadyForPickup = 
        !order.agentId && 
        (order.status === 'READY_FOR_PICKUP' || order.status === 'SEARCHING_AGENT') &&
        status === 'PICKED_UP';
      
      if (!isOrderAssignedToAgent && !isUnassignedAndReadyForPickup) {
        return res.status(403).json({ 
          error: 'You do not have permission to update this order. The order must be assigned to you or you must accept it first.' 
        });
      }

      // Update order status with appropriate timestamps
      const updateData: any = { status };

      if (status === 'PICKED_UP' && !order.pickedUpAt) {
        updateData.pickedUpAt = new Date();
        
        // If order is not yet assigned to this agent, assign it now
        if (!order.agentId && isUnassignedAndReadyForPickup) {
          updateData.agentId = agentId;
          // Status will be set to PICKED_UP (from the request body)
        }
        
        // Check if this is a warehouse-to-warehouse transport (leg 2 of multi-leg order)
        // If order has logisticsProviderId, currentWarehouseId, and dropWarehouseId, it's in transit
        if (order.logisticsProviderId && order.currentWarehouseId && order.dropWarehouseId) {
          // Check transit legs to confirm this is leg 2
          const transitLegs = order.transitLegs as any;
          if (Array.isArray(transitLegs)) {
            const leg2 = transitLegs.find((leg: any) => leg.leg === 2);
            // If leg 2 exists and we're picking up from origin warehouse to go to destination warehouse
            if (leg2 && (leg2.originWarehouseId === order.currentWarehouseId || 
                         leg2.warehouseId === order.currentWarehouseId)) {
              // This is warehouse-to-warehouse transport, set status to IN_TRANSIT
              updateData.status = 'IN_TRANSIT';
              updateData.transitStatus = 'In Transit';
              
              // Update leg 2 status
              leg2.status = 'IN_TRANSIT';
              leg2.updatedAt = new Date().toISOString();
              updateData.transitLegs = transitLegs;
            }
          }
        }
      }

      if (status === 'DELIVERED' && !order.deliveredAt) {
        // Check if this is a delivery to a warehouse (multi-leg order)
        if (order.dropWarehouseId) {
          // This is a delivery to a warehouse, mark as AT_WAREHOUSE instead
          const warehouse = await prisma.warehouse.findUnique({
            where: { id: order.dropWarehouseId },
            select: { id: true, latitude: true, longitude: true, name: true },
          });

          if (!warehouse) {
            return res.status(400).json({ error: 'Drop warehouse not found' });
          }

          // Calculate actual duration
          let actualDuration = undefined;
          if (order.pickedUpAt) {
            actualDuration = Math.floor((new Date().getTime() - order.pickedUpAt.getTime()) / 60000);
          }

          // Update transit legs if this is a multi-leg order
          let updatedTransitLegs = order.transitLegs as any;
          if (Array.isArray(updatedTransitLegs)) {
            // Find and update the appropriate leg
            const leg1 = updatedTransitLegs.find((leg: any) => leg.leg === 1);
            const leg2 = updatedTransitLegs.find((leg: any) => leg.leg === 2);
            
            // Check if this is leg 1 (SELLER → ORIGIN_WAREHOUSE)
            // Match by warehouseId or originWarehouseId in leg1, or by originWarehouseId on order
            const isLeg1Delivery = leg1 && (
              leg1.warehouseId === order.dropWarehouseId ||
              leg1.warehouseId === order.originWarehouseId ||
              order.originWarehouseId === order.dropWarehouseId
            );
            
            if (isLeg1Delivery) {
              leg1.status = 'COMPLETED';
              leg1.completedAt = new Date().toISOString();
              leg1.updatedAt = new Date().toISOString();
              // Update the leg in the array
              const leg1Index = updatedTransitLegs.findIndex((leg: any) => leg.leg === 1);
              if (leg1Index >= 0) {
                updatedTransitLegs[leg1Index] = leg1;
              }
            }
            // Check if this is leg 2 (ORIGIN_WAREHOUSE → DESTINATION_WAREHOUSE)
            else if (leg2 && (leg2.destinationWarehouseId === order.dropWarehouseId || leg2.warehouseId === order.dropWarehouseId)) {
              leg2.status = 'COMPLETED';
              leg2.completedAt = new Date().toISOString();
              leg2.updatedAt = new Date().toISOString();
              // Update the leg in the array
              const leg2Index = updatedTransitLegs.findIndex((leg: any) => leg.leg === 2);
              if (leg2Index >= 0) {
                updatedTransitLegs[leg2Index] = leg2;
              }
            }
          }

          // Update order to AT_WAREHOUSE status
          // IMPORTANT: Preserve logisticsProviderId so order remains visible to logistics provider
          updateData.status = 'AT_WAREHOUSE';
          updateData.currentWarehouseId = order.dropWarehouseId;
          updateData.warehouseArrivedAt = new Date();
          updateData.actualDuration = actualDuration;
          // Explicitly preserve logisticsProviderId if it exists
          if (order.logisticsProviderId) {
            updateData.logisticsProviderId = order.logisticsProviderId;
            console.log(`[Agent Controller] Preserving logisticsProviderId ${order.logisticsProviderId} for order ${orderId} at AT_WAREHOUSE`);
          } else {
            console.warn(`[Agent Controller] WARNING: Order ${orderId} reached AT_WAREHOUSE but has no logisticsProviderId!`);
          }
          if (updatedTransitLegs) {
            updateData.transitLegs = updatedTransitLegs;
          }

          // Update order
          await prisma.order.update({
            where: { id: orderId },
            data: updateData,
          });

          // Update agent stats (order is completed for this agent)
          await prisma.agent.update({
            where: { id: agentId },
            data: {
              completedOrders: { increment: 1 },
              totalOrders: { increment: 1 },
              currentOrderId: null,
              status: 'ONLINE',
            },
          });

          // Check if this is destination warehouse and create delivery order
          // NOTE: When order reaches origin warehouse (leg 1 complete), logistics provider should see it
          // and can assign a logistics agent for leg 2 (origin → destination warehouse transport)
          if (Array.isArray(updatedTransitLegs)) {
            const leg1 = updatedTransitLegs.find((leg: any) => leg.leg === 1);
            const leg2 = updatedTransitLegs.find((leg: any) => leg.leg === 2);
            const leg3 = updatedTransitLegs.find((leg: any) => leg.leg === 3);
            
            // If this is leg 1 completion (order at origin warehouse), order is now visible to logistics provider
            // Logistics provider can assign logistics agent for leg 2
            if (leg1 && leg1.status === 'COMPLETED' && leg1.warehouseId === order.dropWarehouseId) {
              console.log(`[Agent Controller] Order ${orderId} reached origin warehouse. Logistics provider can now assign agent for leg 2.`);
            }
            
            // If this is destination warehouse (leg 2 complete), create delivery order for leg 3
            if (leg3 && (leg3.warehouseId === order.dropWarehouseId || leg3.destinationWarehouseId === order.dropWarehouseId)) {
              // This is destination warehouse - create delivery order for leg 3
              try {
                const { logisticsOrderService } = await import('../services/logistics-order.service');
                await logisticsOrderService.createDeliveryOrderFromWarehouse(
                  orderId,
                  order.dropWarehouseId,
                  leg3.finalDeliveryLat,
                  leg3.finalDeliveryLng,
                  leg3.finalDeliveryAddress || 'Customer Address',
                  leg3.finalDeliveryWarehouseId
                );
              } catch (error: any) {
                console.error('[Agent Controller] Error creating delivery order:', error?.message);
                // Don't fail the request if delivery order creation fails
              }
            }
          }

          // Return response
          const updatedOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              status: true,
              partnerId: true,
              currentWarehouseId: true,
            },
          });

          if (updatedOrder) {
            await notifyPartnerOrderStatusUpdate(
              updatedOrder.partnerId,
              {
                id: updatedOrder.id,
                status: updatedOrder.status,
                currentWarehouseId: updatedOrder.currentWarehouseId,
              }
            );

            await notifyAgentOrderStatusUpdate(
              agentId,
              {
                id: updatedOrder.id,
                status: updatedOrder.status,
              }
            );
          }

          return res.json({
            id: updatedOrder?.id,
            status: updatedOrder?.status,
            message: 'Order delivered to warehouse successfully',
          });
        } else {
          // This is a final delivery to customer
          updateData.deliveredAt = new Date();
          // Calculate actual duration
          if (order.pickedUpAt) {
            const duration = Math.floor((new Date().getTime() - order.pickedUpAt.getTime()) / 60000);
            updateData.actualDuration = duration;
          }
          
          // Wrap order delivery and wallet operations in a single transaction
          // This ensures atomicity and prevents double crediting
          const { walletService } = await import('../services/wallet.service');
          const { revenueService } = await import('../services/revenue.service');
          
          const updatedOrder = await prisma.$transaction(async (tx) => {
            // Check if order was already processed (idempotency check)
            const existingRevenue = await tx.platformRevenue.findUnique({
              where: { orderId },
            });

            if (existingRevenue && existingRevenue.status === 'PROCESSED') {
              // Order already processed, return existing order
              const existingOrder = await tx.order.findUnique({
                where: { id: orderId },
                select: {
                  id: true,
                  status: true,
                  deliveredAt: true,
                  actualDuration: true,
                  partnerId: true,
                },
              });
              if (existingOrder) {
                return existingOrder;
              }
            }

            // Update order status first so revenue calculation works
            await tx.order.update({
              where: { id: orderId },
              data: updateData,
            });

            // Calculate revenue for this order (70/30 split)
            const revenue = await revenueService.calculateOrderRevenue(orderId, tx);
            
            // Credit agent wallet with 70% (payoutAmount) - only if not already processed
            if (!existingRevenue) {
              await walletService.creditAgentWallet(
                agentId,
                revenue.deliveryFee, // 70% of orderAmount
                orderId,
                `Earning from order ${orderId.substring(0, 8).toUpperCase()} (70% of order)`,
                tx
              );

              // Credit admin wallet with 30% commission
              await walletService.creditAdminWallet(
                revenue.platformFee, // 30% of orderAmount
                orderId,
                `Commission from order ${orderId.substring(0, 8).toUpperCase()} (30% of order)`,
                tx
              );

              // Create platform revenue record
              const now = new Date();
              const periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
              
              try {
                await revenueService.createPlatformRevenue(
                  orderId,
                  order.partnerId,
                  agentId,
                  periodStart,
                  periodEnd,
                  'DAILY',
                  tx
                );
              } catch (revenueError: any) {
                // Log error but don't fail transaction - revenue record creation failure shouldn't block delivery
                logger.error('[Agent Controller] Failed to create platform revenue record', revenueError, {
                  orderId,
                  agentId,
                  partnerId: order.partnerId,
                });
                // Note: Wallets are already credited, so this is just a record-keeping issue
                // The transaction will still complete, but revenue reporting may be incomplete
              }
            }

            // Update agent stats
            await tx.agent.update({
              where: { id: agentId },
              data: {
                completedOrders: { increment: 1 },
                totalOrders: { increment: 1 },
                currentOrderId: null,
                status: 'ONLINE', // Back to online after delivery
              },
            });

            // Return updated order
            return await tx.order.findUnique({
              where: { id: orderId },
              select: {
                id: true,
                status: true,
                deliveredAt: true,
                actualDuration: true,
                partnerId: true,
              },
            });
          }, {
            isolationLevel: 'Serializable',
            timeout: 30000,
          });

          // Calculate and store billing amounts (for invoicing) - outside transaction
          try {
            const { billingService } = await import('../services/billing.service');
            await billingService.updateOrderBilling(orderId);
          } catch (billingError: any) {
            console.error('[Agent Controller] Error calculating billing:', billingError?.message);
            // Don't fail the order update if billing calculation fails
          }

          // Deduct from wallet if LOCAL_STORE partner (wallet-based billing) - outside transaction
          try {
            const { partnerWalletService } = await import('../services/partner-wallet.service');
            await partnerWalletService.deductOnDelivery(orderId);
          } catch (walletError: any) {
            console.error('[Agent Controller] Error deducting from wallet:', walletError?.message);
            // Don't fail the order update if wallet deduction fails, but log it
          }

          if (updatedOrder) {
            // Notify partner via WebSocket for real-time updates
            await notifyPartnerOrderStatusUpdate(
              updatedOrder.partnerId,
              {
                id: updatedOrder.id,
                status: updatedOrder.status,
                deliveredAt: updatedOrder.deliveredAt?.toISOString(),
              }
            );

            // Notify agent via WebSocket for real-time updates
            await notifyAgentOrderStatusUpdate(
              agentId,
              {
                id: updatedOrder.id,
                status: updatedOrder.status,
                deliveredAt: updatedOrder.deliveredAt?.toISOString(),
              }
            );
          }

          return res.json({
            id: updatedOrder?.id,
            status: updatedOrder?.status,
            message: 'Order delivered successfully',
          });
        }
      }

      if (status === 'CANCELLED') {
        updateData.cancelledAt = new Date();
        updateData.cancellationReason = cancellationReason;
        
        // EDGE CASE 4: Leg 3 delivery failure (customer unavailable, etc.)
        // Check if this is a Leg 3 order (final delivery from warehouse to customer)
        const orderForRTO = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            transitLegs: true,
            pickupWarehouseId: true,
            logisticsProviderId: true,
            currentWarehouseId: true,
            originWarehouseId: true,
            status: true,
          },
        });

        if (orderForRTO) {
          const transitLegs = orderForRTO.transitLegs as any;
          const isLeg3Order = transitLegs?.leg === 'FINAL_DELIVERY' || 
                            transitLegs?.parentOrderId || 
                            (orderForRTO.pickupWarehouseId && 
                             orderForRTO.status !== 'IN_TRANSIT' && 
                             orderForRTO.status !== 'AT_WAREHOUSE');

          // If this is Leg 3 and order is at destination warehouse, create RTO
          // Standard retry → RTO, do NOT reopen Leg 2
          if (isLeg3Order && orderForRTO.pickupWarehouseId) {
            try {
              const { logisticsOrderService } = await import('../services/logistics-order.service');
              // Extract parentOrderId from transitLegs (properly typed)
              const parentOrderId = (transitLegs && typeof transitLegs === 'object' && transitLegs !== null && 'parentOrderId' in transitLegs)
                ? (transitLegs as { parentOrderId?: string }).parentOrderId || orderId
                : orderId;
              
              await logisticsOrderService.createRTOOrder(
                parentOrderId, // Use parent order ID if available
                cancellationReason || 'Leg 3 delivery failed - customer unavailable',
                orderForRTO.pickupWarehouseId // Current warehouse (destination)
              );
              console.log(`[Agent Controller] Created RTO order for failed Leg 3 delivery ${orderId}`);
            } catch (error: any) {
              console.error(`[Agent Controller] Failed to create RTO order for Leg 3 failure:`, error);
              // Continue with cancellation even if RTO creation fails
            }
          }
        }

        // Update agent stats
        await prisma.agent.update({
          where: { id: agentId },
          data: {
            cancelledOrders: { increment: 1 },
            totalOrders: { increment: 1 },
            currentOrderId: null,
            status: 'ONLINE',
          },
        });
      }

      // Update order (using select to avoid barcode/qrCode if columns don't exist)
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: updateData,
        select: {
          id: true,
          status: true,
          agentId: true,
          partnerId: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          priority: true,
          estimatedDuration: true,
          actualDuration: true,
          pickedUpAt: true,
          deliveredAt: true,
          cancelledAt: true,
          cancellationReason: true,
          assignedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Check for delay after status update (if order was picked up, is out for delivery, or in transit)
      // Note: IN_TRANSIT orders (warehouse-to-warehouse) may not have pickedUpAt set, so we check the status
      if ((status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY' || status === 'IN_TRANSIT') && updatedOrder.pickedUpAt) {
        const { delayCheckerService } = await import('../services/delay-checker.service');
        // Run delay check asynchronously (don't wait)
        delayCheckerService.checkOrderDelay(orderId).catch(err => 
          console.error('[Agent Controller] Error checking delay status:', err)
        );
      }

      // Fetch updated order with select to avoid accessing non-existent columns
      const orderWithIncludes = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          partner: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!orderWithIncludes) {
        return res.status(404).json({ error: 'Order not found after update' });
      }

      // Notify partner via webhook
      await notifyPartner(
        orderWithIncludes.partner.id,
        `ORDER_${status}`,
        updatedOrder.id,
        updatedOrder.status,
        {
          pickedUpAt: updatedOrder.pickedUpAt,
          deliveredAt: updatedOrder.deliveredAt,
          cancelledAt: updatedOrder.cancelledAt,
          cancellationReason: updatedOrder.cancellationReason,
        }
      );

      // Notify partner via WebSocket for real-time updates
      await notifyPartnerOrderStatusUpdate(
        orderWithIncludes.partner.id,
        {
          id: updatedOrder.id,
          status: updatedOrder.status,
          pickedUpAt: updatedOrder.pickedUpAt?.toISOString(),
          deliveredAt: updatedOrder.deliveredAt?.toISOString(),
          cancelledAt: updatedOrder.cancelledAt?.toISOString(),
          cancellationReason: updatedOrder.cancellationReason,
        }
      );

      // Notify agent via WebSocket for real-time updates (so they see their own updates)
      await notifyAgentOrderStatusUpdate(
        agentId,
        {
          id: updatedOrder.id,
          status: updatedOrder.status,
          pickedUpAt: updatedOrder.pickedUpAt?.toISOString(),
          deliveredAt: updatedOrder.deliveredAt?.toISOString(),
          cancelledAt: updatedOrder.cancelledAt?.toISOString(),
          cancellationReason: updatedOrder.cancellationReason,
        }
      );

      // Log order status update event
      const userId = getUserId(req);
      let eventType: EventType;
      switch (status) {
        case 'PICKED_UP':
          eventType = EventType.ORDER_PICKED_UP;
          break;
        case 'OUT_FOR_DELIVERY':
          eventType = EventType.ORDER_OUT_FOR_DELIVERY;
          break;
        case 'DELIVERED':
          eventType = EventType.ORDER_DELIVERED;
          break;
        case 'CANCELLED':
          eventType = EventType.ORDER_CANCELLED;
          break;
        default:
          eventType = EventType.ORDER_ASSIGNED;
      }
      
      eventService.logOrderEvent(
        eventType,
        orderId,
        ActorType.AGENT,
        userId ?? undefined,
        {
          agentId,
          previousStatus: order.status,
          newStatus: status,
          actualDuration: updatedOrder.actualDuration,
          cancellationReason: updatedOrder.cancellationReason,
        }
      );

      res.json({
        id: updatedOrder.id,
        status: updatedOrder.status,
        message: 'Order status updated successfully',
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/agent/metrics - Get agent metrics and statistics
  async getMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        console.error('[Agent Metrics] No agent ID found in request');
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      // Get agent with current order
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          currentOrderId: true,
          totalOrders: true,
          completedOrders: true,
          cancelledOrders: true,
          acceptanceRate: true,
          rating: true,
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Get today's orders
      const todayOrders = await prisma.order.count({
        where: {
          agentId,
          createdAt: {
            gte: todayStart,
          },
        },
      });

      // Get this month's orders
      const thisMonthOrders = await prisma.order.findMany({
        where: {
          agentId,
          createdAt: {
            gte: thisMonthStart,
          },
          status: 'DELIVERED',
        },
        select: {
          payoutAmount: true,
        },
      });

      // Get last month's earnings for comparison
      const lastMonthOrders = await prisma.order.findMany({
        where: {
          agentId,
          createdAt: {
            gte: lastMonthStart,
            lte: lastMonthEnd,
          },
          status: 'DELIVERED',
        },
        select: {
          payoutAmount: true,
        },
      });

      // Calculate earnings
      const monthlyEarnings = thisMonthOrders.reduce((sum, order) => sum + order.payoutAmount, 0);
      const lastMonthEarnings = lastMonthOrders.reduce((sum, order) => sum + order.payoutAmount, 0);
      const earningsChange = lastMonthEarnings > 0 
        ? ((monthlyEarnings - lastMonthEarnings) / lastMonthEarnings) * 100 
        : 0;

      // Get yesterday's orders count for comparison
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(todayStart);
      
      const yesterdayOrders = await prisma.order.count({
        where: {
          agentId,
          createdAt: {
            gte: yesterdayStart,
            lt: yesterdayEnd,
          },
        },
      });

      const ordersChange = yesterdayOrders > 0 
        ? ((todayOrders - yesterdayOrders) / yesterdayOrders) * 100 
        : 0;

      // Active orders (orders that are assigned, picked up, or out for delivery)
      // Query WITHOUT DELAYED to avoid enum errors - DELAYED doesn't exist in database enum yet
      let activeOrders = 0;
      try {
        // Only query statuses that definitely exist in the database enum
        activeOrders = await prisma.order.count({
          where: {
            agentId,
            status: {
              in: [OrderStatus.ASSIGNED, OrderStatus.PICKED_UP, OrderStatus.OUT_FOR_DELIVERY],
            },
          },
        });
      } catch (activeOrdersError: any) {
        console.error('[Agent Metrics] Error counting active orders:', activeOrdersError?.message);
        activeOrders = 0;
      }

      // Get active order details if exists
      // Check both currentOrderId and any active order assigned to this agent
      let activeOrder = null;
      
      // First try currentOrderId
      let orderToCheck = agent.currentOrderId;
      
      // If no currentOrderId, check for any active order assigned to this agent
      if (!orderToCheck) {
        // Query WITHOUT DELAYED to avoid enum errors
        const activeOrderRecord = await prisma.order.findFirst({
          where: {
            agentId,
            status: {
              in: [OrderStatus.ASSIGNED, OrderStatus.PICKED_UP, OrderStatus.OUT_FOR_DELIVERY],
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
          },
        });
        
        orderToCheck = activeOrderRecord?.id || null;
      }
      
      if (orderToCheck) {
        try {
          const order = await prisma.order.findUnique({
            where: { id: orderToCheck },
            include: {
              partner: {
                include: {
                  user: {
                    select: {
                      name: true,
                      phone: true,
                    },
                  },
                },
              },
            },
          });

          if (!order) {
            console.warn('[Agent Metrics] Order not found:', orderToCheck);
            activeOrder = null;
          } else {
            // Check if order status is active (excluding DELAYED to avoid enum errors)
            const activeStatuses: OrderStatus[] = [
              OrderStatus.ASSIGNED, 
              OrderStatus.PICKED_UP, 
              OrderStatus.OUT_FOR_DELIVERY
            ];
            
            const isActiveStatus = activeStatuses.includes(order.status as OrderStatus);
            
            if (isActiveStatus) {
              // Check and update delayed status
              let refreshedOrder = order;
              let timing = null;
              
              try {
                // Dynamically import delay checker service
                let delayCheckerService;
                try {
                  const delayModule = await import('../services/delay-checker.service');
                  delayCheckerService = delayModule.delayCheckerService;
                } catch (importError: any) {
                  console.warn('[Agent Metrics] Could not import delay-checker service:', importError?.message);
                  delayCheckerService = null;
                }

                if (delayCheckerService) {
                  try {
                    await delayCheckerService.checkOrderDelay(order.id);
                  } catch (checkError: any) {
                    console.warn('[Agent Metrics] Error checking order delay:', checkError?.message);
                    // Continue even if delay check fails
                  }
                }
                
                // Refresh order to get updated status (without relations to avoid type issues)
                // Use select to avoid fetching barcode/qrCode if columns don't exist yet
                try {
                  const refreshedOrderData = await prisma.order.findUnique({
                    where: { id: order.id },
                    select: {
                      id: true,
                      status: true,
                      agentId: true,
                      partnerId: true,
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
                      createdAt: true,
                      updatedAt: true,
                    },
                  });
                  
                  if (refreshedOrderData) {
                    // Merge refreshed data with original order to keep partner relation
                    refreshedOrder = {
                      ...order,
                      status: refreshedOrderData.status,
                      pickedUpAt: refreshedOrderData.pickedUpAt,
                      estimatedDuration: refreshedOrderData.estimatedDuration,
                    };
                  }
                } catch (refreshError: any) {
                  console.warn('[Agent Metrics] Error refreshing order:', refreshError?.message);
                  // Use original order if refresh fails
                }

                // Calculate timing information
                if (delayCheckerService) {
                  try {
                    timing = delayCheckerService.getOrderTiming({
                      pickedUpAt: refreshedOrder.pickedUpAt || null,
                      estimatedDuration: refreshedOrder.estimatedDuration || null,
                    });
                  } catch (timingError: any) {
                    console.warn('[Agent Metrics] Error calculating timing:', timingError?.message);
                    timing = null;
                  }
                }
              } catch (delayError: any) {
                console.error('[Agent Metrics] Unexpected error in delay checker block:', delayError);
                // Continue without timing if delay checker fails
              }
              
              // Set default timing if not calculated
              if (!timing) {
                timing = {
                  elapsedMinutes: null,
                  remainingMinutes: null,
                  isDelayed: false,
                  elapsedTime: null,
                  remainingTime: null,
                };
              }

              // Safely access partner data with null checks
              const partnerName = order.partner?.user?.name || 'Unknown Partner';
              const partnerCompanyName = order.partner?.companyName || '';
              const partnerPhone = order.partner?.user?.phone || '';

              activeOrder = {
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
                priority: order.priority || 'NORMAL',
                estimatedDuration: refreshedOrder?.estimatedDuration || order.estimatedDuration,
                pickedUpAt: order.pickedUpAt?.toISOString(),
                assignedAt: order.assignedAt?.toISOString(),
                timing,
                partner: {
                  name: partnerName,
                  companyName: partnerCompanyName,
                  phone: partnerPhone,
                },
              };
            } else {
              // Order exists but is not in an active status
              activeOrder = null;
            }
          }
        } catch (error: any) {
          console.error('[Agent Metrics] Error fetching active order:', error);
          console.error('[Agent Metrics] Error details:', {
            message: error?.message,
            stack: error?.stack,
            orderId: orderToCheck,
          });
          // Continue without active order if there's an error
          activeOrder = null;
        }
      }

      // Ensure all values are valid numbers
      const response = {
        todayOrders: Number(todayOrders) || 0,
        yesterdayOrders: Number(yesterdayOrders) || 0,
        ordersChange: Math.round(Number(ordersChange)) || 0,
        monthlyEarnings: Number(monthlyEarnings) || 0,
        lastMonthEarnings: Number(lastMonthEarnings) || 0,
        earningsChange: Math.round(Number(earningsChange)) || 0,
        activeOrders: Number(activeOrders) || 0,
        completedOrders: Number(agent.completedOrders) || 0,
        totalOrders: Number(agent.totalOrders) || 0,
        cancelledOrders: Number(agent.cancelledOrders) || 0,
        acceptanceRate: Number(agent.acceptanceRate) || 0,
        rating: Number(agent.rating) || 0,
        thisMonthOrders: Number(thisMonthOrders.length) || 0,
        activeOrder: activeOrder || null,
      };

      res.json(response);
    } catch (error: any) {
      console.error('[Agent Metrics] Error in getMetrics:', error);
      console.error('[Agent Metrics] Error details:', {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
        code: error?.code,
        agentId: getAgentId(req as any),
      });
      
      // Return a more detailed error response for common issues
      if (error?.code === 'P2002' || error?.message?.includes('Unique constraint')) {
        return res.status(400).json({ error: 'Database constraint violation' });
      }
      
      if (error?.code === 'P2025' || error?.message?.includes('Record not found')) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      // Log full error for debugging in production
      if (process.env.NODE_ENV === 'production') {
        console.error('[Agent Metrics] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      }
      
      next(error);
    }
  },

  // GET /api/agent/documents - Get all documents for the agent
  async getDocuments(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const documents = await prisma.agentDocument.findMany({
        where: { agentId },
        orderBy: { uploadedAt: 'desc' },
      });

      res.json(documents.map(doc => ({
        id: doc.id,
        documentType: doc.documentType,
        fileName: doc.fileName,
        fileUrl: doc.fileUrl,
        verified: doc.verified,
        uploadedAt: doc.uploadedAt.toISOString(),
      })));
    } catch (error) {
      next(error);
    }
  },

  // POST /api/agent/documents - Upload a document
  async uploadDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { documentType } = req.body;
      if (!documentType) {
        // Delete uploaded file if documentType is missing
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Document type is required' });
      }

      // Generate file URL (relative to /uploads/documents/)
      const fileUrl = `/uploads/documents/${req.file.filename}`;

      // Create document record
      const document = await prisma.agentDocument.create({
        data: {
          agentId,
          documentType,
          fileName: req.file.originalname,
          fileUrl,
          verified: false,
        },
      });

      res.status(201).json({
        id: document.id,
        documentType: document.documentType,
        fileName: document.fileName,
        fileUrl: document.fileUrl,
        verified: document.verified,
        uploadedAt: document.uploadedAt.toISOString(),
      });
    } catch (error) {
      // Clean up uploaded file if there's an error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error('Error deleting file:', unlinkError);
        }
      }
      next(error);
    }
  },

  // DELETE /api/agent/documents/:id - Delete a document
  async deleteDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const { id } = req.params;

      // Find the document and verify it belongs to the agent
      const document = await prisma.agentDocument.findUnique({
        where: { id },
      });

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (document.agentId !== agentId) {
        return res.status(403).json({ error: 'You do not have permission to delete this document' });
      }

      // Delete the file from filesystem
      const filePath = path.join(process.cwd(), document.fileUrl);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileError) {
        console.error('Error deleting file:', fileError);
        // Continue with database deletion even if file deletion fails
      }

      // Delete the document record
      await prisma.agentDocument.delete({
        where: { id },
      });

      res.json({ message: 'Document deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/agent/support/tickets - Get agent's support tickets
  async getSupportTickets(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getUserId(req);
      const agentId = getAgentId(req);
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { status, page = '1', limit = '20' } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {
        userId,
        ...(agentId ? { agentId } : {}),
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
          }).catch((err: any) => {
            if (err?.code === 'P2021' || err?.code === 'P2022' || err?.code === '42P01' || err?.message?.includes('does not exist')) {
              return [];
            }
            throw err;
          }),
          prisma.supportTicket.count({ where }).catch((err: any) => {
            if (err?.code === 'P2021' || err?.code === 'P2022' || err?.code === '42P01' || err?.message?.includes('does not exist')) {
              return 0;
            }
            throw err;
          }),
        ]);
      } catch (error: any) {
        // If table doesn't exist, return empty results
        if (error?.code === 'P2021' || error?.code === 'P2022' || error?.code === '42P01' || error?.message?.includes('does not exist')) {
          console.warn('⚠️  SupportTicket table does not exist - returning empty results');
          tickets = [];
          total = 0;
        } else {
          throw error;
        }
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

  // POST /api/agent/support/tickets - Create support ticket
  async createSupportTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getUserId(req);
      const agentId = getAgentId(req);
      
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

      // Verify order exists and belongs to agent if orderId is provided
      // Use select to avoid fetching barcode/qrCode if columns don't exist yet
      if (orderId) {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            status: true,
            agentId: true,
            partnerId: true,
          },
        });

        if (!order) {
          return res.status(404).json({ error: 'Order not found' });
        }

        if (order.agentId !== agentId) {
          return res.status(403).json({ error: 'You can only create tickets for your own orders' });
        }
      }

      const ticket = await prisma.supportTicket.create({
        data: {
          userId,
          agentId: agentId || null,
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
};

