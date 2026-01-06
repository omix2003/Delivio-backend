import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { getLogisticsProviderId, getUserId } from '../utils/role.util';
import { warehouseService } from '../services/warehouse.service';
import { logisticsService } from '../services/logistics.service';
import { OrderStatus } from '@prisma/client';
import {
  getPossibleLogisticsProviderIds,
  getLogisticsProviderWarehouses,
  buildLogisticsProviderOrderWhere,
  verifyWarehouseOwnership,
} from '../utils/logistics-provider.util';

export const logisticsProviderController = {
  // GET /api/logistics-provider/profile
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const logisticsProvider = await prisma.logisticsProvider.findUnique({
        where: { id: logisticsProviderId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          warehouses: {
            select: {
              id: true,
              name: true,
              address: true,
              latitude: true,
              longitude: true,
              isActive: true,
            },
          },
        },
      });

      if (!logisticsProvider) {
        return res.status(404).json({ error: 'Logistics provider not found' });
      }

      res.json({
        id: logisticsProvider.id,
        userId: logisticsProvider.userId,
        companyName: logisticsProvider.companyName,
        businessName: logisticsProvider.businessName,
        apiKey: logisticsProvider.apiKey,
        webhookUrl: logisticsProvider.webhookUrl,
        isActive: logisticsProvider.isActive,
        address: logisticsProvider.address,
        city: logisticsProvider.city,
        state: logisticsProvider.state,
        pincode: logisticsProvider.pincode,
        contactPhone: logisticsProvider.contactPhone,
        billingEmail: logisticsProvider.billingEmail,
        user: logisticsProvider.user,
        warehouses: logisticsProvider.warehouses,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/logistics-provider/dashboard
  async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        totalOrders,
        activeOrders,
        inTransitOrders,
        readyForPickupOrders,
        completedOrders,
        totalAgents,
        activeAgents,
        totalWarehouses,
      ] = await Promise.all([
        // Total orders
        prisma.order.count({
          where: {
            logisticsProviderId,
          },
        }),
        // Active orders (in transit, ready for pickup, searching agent)
        prisma.order.count({
          where: {
            logisticsProviderId,
            status: {
              in: [
                OrderStatus.IN_TRANSIT,
                OrderStatus.READY_FOR_PICKUP,
                OrderStatus.SEARCHING_AGENT,
                OrderStatus.ASSIGNED,
                OrderStatus.PICKED_UP,
                OrderStatus.OUT_FOR_DELIVERY,
              ],
            },
          },
        }),
        // In transit orders
        prisma.order.count({
          where: {
            logisticsProviderId,
            status: OrderStatus.IN_TRANSIT,
          },
        }),
        // Ready for pickup orders
        prisma.order.count({
          where: {
            logisticsProviderId,
            status: OrderStatus.READY_FOR_PICKUP,
          },
        }),
        // Completed orders
        prisma.order.count({
          where: {
            logisticsProviderId,
            status: OrderStatus.DELIVERED,
            deliveredAt: { gte: thisMonthStart },
          },
        }),
        // Total agents
        prisma.logisticsAgent.count({
          where: {
            logisticsProviderId,
          },
        }),
        // Active agents
        prisma.logisticsAgent.count({
          where: {
            logisticsProviderId,
            isActive: true,
            isOnline: true,
          },
        }),
        // Total warehouses
        prisma.warehouse.count({
          where: {
            logisticsProviderId,
          },
        }),
      ]);

      // Get status breakdown for orders
      const statusBreakdown = await prisma.order.groupBy({
        by: ['status'],
        where: {
          logisticsProviderId,
        },
        _count: {
          id: true,
        },
      });

      const statusBreakdownMap: Record<string, number> = {};
      statusBreakdown.forEach((item) => {
        statusBreakdownMap[item.status] = item._count.id;
      });

      // Get today's orders and completed orders
      const ordersToday = await prisma.order.count({
        where: {
          logisticsProviderId,
          createdAt: { gte: todayStart },
        },
      });

      const completedToday = await prisma.order.count({
        where: {
          logisticsProviderId,
          status: OrderStatus.DELIVERED,
          deliveredAt: { gte: todayStart },
        },
      });

      res.json({
        metrics: {
          ordersToday,
          completedToday,
          totalAgents,
          onlineAgents: activeAgents,
          totalOrders,
          activeOrders,
          inTransitOrders,
          readyForPickupOrders,
          completedOrders,
          totalWarehouses,
          statusBreakdown: statusBreakdownMap,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/logistics-provider/orders
  async getOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const { status, limit = 50, offset = 0 } = req.query;

      // Build where clause using utility function
      const baseWhere: any = {};
      
      if (status && status !== 'all') {
        if (Array.isArray(status)) {
          baseWhere.status = {
            in: status.filter((s): s is string => typeof s === 'string').map((s) => s as OrderStatus),
          };
        } else if (typeof status === 'string') {
          baseWhere.status = status as OrderStatus;
        }
      }

      const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, baseWhere);

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          select: {
            id: true,
            status: true,
            transitStatus: true,
            transitTrackingNumber: true,
            transitLegs: true,
            pickupLat: true,
            pickupLng: true,
            dropLat: true,
            dropLng: true,
            currentWarehouseId: true,
            originWarehouseId: true,
            dropWarehouseId: true,
            expectedWarehouseArrival: true,
            createdAt: true,
            updatedAt: true,
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
          take: Number(limit),
          skip: Number(offset),
        }),
        prisma.order.count({ where }),
      ]);

      res.json({
        orders: orders.map((order) => {
          // Extract final delivery address from transit legs for multi-leg orders
          let finalDeliveryLat = order.dropLat;
          let finalDeliveryLng = order.dropLng;

          if (order.transitLegs && Array.isArray(order.transitLegs)) {
            const leg3 = (order.transitLegs as any[]).find((leg: any) => leg.leg === 3);
            if (leg3 && leg3.finalDeliveryLat && leg3.finalDeliveryLng) {
              finalDeliveryLat = leg3.finalDeliveryLat;
              finalDeliveryLng = leg3.finalDeliveryLng;
            }
          }

          return {
            id: order.id,
            trackingNumber: order.transitTrackingNumber || order.id.substring(0, 8).toUpperCase(),
            status: order.status,
            transitStatus: order.transitStatus,
            pickup: {
              latitude: order.pickupLat,
              longitude: order.pickupLng,
            },
            dropoff: {
              latitude: finalDeliveryLat,
              longitude: finalDeliveryLng,
            },
            originWarehouse: order.originWarehouse,
            currentWarehouse: order.currentWarehouse,
            dropWarehouse: order.dropWarehouse,
            expectedWarehouseArrival: order.expectedWarehouseArrival?.toISOString(),
            createdAt: order.createdAt.toISOString(),
            updatedAt: order.updatedAt.toISOString(),
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

  // GET /api/logistics-provider/orders/:id
  async getOrderDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const orderId = req.params.id;

      // Verify order belongs to this logistics provider
      const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, {
        id: orderId,
      });

      const order = await prisma.order.findFirst({
        where,
        include: {
          originWarehouse: {
            select: {
              id: true,
              name: true,
              address: true,
              latitude: true,
              longitude: true,
            },
          },
          currentWarehouse: {
            select: {
              id: true,
              name: true,
              address: true,
              latitude: true,
              longitude: true,
            },
          },
          dropWarehouse: {
            select: {
              id: true,
              name: true,
              address: true,
              latitude: true,
              longitude: true,
            },
          },
          partner: {
            select: {
              id: true,
              companyName: true,
            },
          },
          logisticsProvider: {
            select: {
              id: true,
              companyName: true,
            },
          },
          logisticsAgent: {
            select: {
              id: true,
              name: true,
              vehicleNumber: true,
              vehicleType: true,
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Extract final delivery address from transit legs for multi-leg orders
      let finalDeliveryLat = order.dropLat;
      let finalDeliveryLng = order.dropLng;
      let finalDeliveryAddress = order.dropAddressText;

      if (order.transitLegs && Array.isArray(order.transitLegs)) {
        const leg3 = (order.transitLegs as any[]).find((leg: any) => leg.leg === 3);
        if (leg3 && leg3.finalDeliveryLat && leg3.finalDeliveryLng) {
          // Use final delivery coordinates from Leg 3 (DESTINATION_WAREHOUSE → DELIVERY)
          finalDeliveryLat = leg3.finalDeliveryLat;
          finalDeliveryLng = leg3.finalDeliveryLng;
          finalDeliveryAddress = leg3.finalDeliveryAddress || order.dropAddressText;
        }
      }

      res.json({
        order: {
          id: order.id,
          trackingNumber: order.transitTrackingNumber || order.id.substring(0, 8).toUpperCase(),
          status: order.status,
          transitStatus: order.transitStatus,
          transitLegs: order.transitLegs,
          pickup: {
            latitude: order.pickupLat,
            longitude: order.pickupLng,
          },
          dropoff: {
            latitude: finalDeliveryLat,
            longitude: finalDeliveryLng,
            address: finalDeliveryAddress,
          },
          originWarehouse: order.originWarehouse,
          originWarehouseId: order.originWarehouseId,
          currentWarehouse: order.currentWarehouse,
          currentWarehouseId: order.currentWarehouseId,
          dropWarehouse: order.dropWarehouse,
          dropWarehouseId: order.dropWarehouseId,
          expectedWarehouseArrival: order.expectedWarehouseArrival?.toISOString(),
          partner: order.partner,
          logisticsProvider: order.logisticsProvider,
          logisticsAgent: order.logisticsAgent,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/logistics-provider/orders/:id/assign-agent
  async assignOrderToAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const orderId = req.params.id;
      const { logisticsAgentId } = req.body;

      if (!logisticsAgentId) {
        return res.status(400).json({ error: 'logisticsAgentId is required' });
      }

      // Verify order belongs to this logistics provider
      const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, {
        id: orderId,
      });
      
      const order = await prisma.order.findFirst({
        where,
        select: {
          id: true,
          status: true,
        },
      });

      if (!order) {
        return res.status(404).json({ error: `Order ${orderId} not found or does not belong to this logistics provider` });
      }

      // Verify agent belongs to this logistics provider
      const agent = await prisma.logisticsAgent.findFirst({
        where: {
          id: logisticsAgentId,
          logisticsProviderId,
        },
        select: {
          id: true,
          currentOrders: true,
          maxOrders: true,
          isActive: true,
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Logistics agent not found' });
      }

      if (!agent.isActive) {
        return res.status(400).json({ error: 'Logistics agent is not active' });
      }

      if (agent.currentOrders >= agent.maxOrders) {
        return res.status(400).json({ error: 'Logistics agent has reached maximum order capacity' });
      }

      // Update order to assign agent
      // Allow assigning to orders that are AT_WAREHOUSE (for warehouse-to-warehouse transport)
      // or SEARCHING_AGENT/READY_FOR_PICKUP (for final delivery)
      const newStatus = (order.status === 'SEARCHING_AGENT' || 
                        order.status === 'READY_FOR_PICKUP' || 
                        order.status === 'AT_WAREHOUSE')
        ? 'ASSIGNED' 
        : order.status;
      
      await prisma.order.update({
        where: { id: orderId },
        data: {
          logisticsAgentId: logisticsAgentId,
          status: newStatus,
        },
      });

      // Update agent's current order count
      await prisma.logisticsAgent.update({
        where: { id: logisticsAgentId },
        data: {
          currentOrders: {
            increment: 1,
          },
        },
      });

      res.json({
        message: 'Order assigned to logistics agent successfully',
        orderId,
        logisticsAgentId,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/logistics-provider/agents
  async getAgents(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const agents = await prisma.logisticsAgent.findMany({
        where: {
          logisticsProviderId,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          vehicleType: true,
          vehicleNumber: true,
          currentOrders: true,
          maxOrders: true,
          area: true,
          areaLatitude: true,
          areaLongitude: true,
          areaRadiusKm: true,
          isActive: true,
          isOnline: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      res.json({ agents });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/logistics-provider/agents
  async createAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const {
        name,
        phone,
        email,
        vehicleType,
        vehicleNumber,
        maxOrders = 5,
        area,
        areaLatitude,
        areaLongitude,
        areaRadiusKm,
      } = req.body;

      const agent = await prisma.logisticsAgent.create({
        data: {
          logisticsProviderId,
          name,
          phone,
          email: email || null,
          vehicleType,
          vehicleNumber,
          maxOrders,
          area: area || null,
          areaLatitude: areaLatitude || null,
          areaLongitude: areaLongitude || null,
          areaRadiusKm: areaRadiusKm || null,
          isActive: true,
          isOnline: false,
        },
      });

      res.status(201).json(agent);
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/logistics-provider/agents/:id
  async updateAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const agentId = req.params.id;

      // Verify agent belongs to this logistics provider
      const existingAgent = await prisma.logisticsAgent.findFirst({
        where: {
          id: agentId,
          logisticsProviderId,
        },
      });

      if (!existingAgent) {
        return res.status(404).json({ error: 'Logistics agent not found' });
      }

      const {
        name,
        phone,
        email,
        vehicleType,
        vehicleNumber,
        maxOrders,
        area,
        areaLatitude,
        areaLongitude,
        areaRadiusKm,
      } = req.body;

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (phone !== undefined) updateData.phone = phone;
      if (email !== undefined) updateData.email = email || null;
      if (vehicleType !== undefined) updateData.vehicleType = vehicleType;
      if (vehicleNumber !== undefined) updateData.vehicleNumber = vehicleNumber;
      if (maxOrders !== undefined) updateData.maxOrders = maxOrders;
      if (area !== undefined) updateData.area = area || null;
      if (areaLatitude !== undefined) updateData.areaLatitude = areaLatitude || null;
      if (areaLongitude !== undefined) updateData.areaLongitude = areaLongitude || null;
      if (areaRadiusKm !== undefined) updateData.areaRadiusKm = areaRadiusKm || null;

      const updatedAgent = await prisma.logisticsAgent.update({
        where: { id: agentId },
        data: updateData,
      });

      res.json(updatedAgent);
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/logistics-provider/agents/:id/status
  async updateAgentStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const agentId = req.params.id;
      const { isActive, isOnline } = req.body;

      // Verify agent belongs to this logistics provider
      const existingAgent = await prisma.logisticsAgent.findFirst({
        where: {
          id: agentId,
          logisticsProviderId,
        },
      });

      if (!existingAgent) {
        return res.status(404).json({ error: 'Logistics agent not found' });
      }

      const updateData: any = {};
      if (isActive !== undefined) updateData.isActive = isActive;
      if (isOnline !== undefined) updateData.isOnline = isOnline;

      const updatedAgent = await prisma.logisticsAgent.update({
        where: { id: agentId },
        data: updateData,
      });

      res.json(updatedAgent);
    } catch (error) {
      next(error);
    }
  },

  // DELETE /api/logistics-provider/agents/:id
  async deleteAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const agentId = req.params.id;

      // Verify agent belongs to this logistics provider
      const existingAgent = await prisma.logisticsAgent.findFirst({
        where: {
          id: agentId,
          logisticsProviderId,
        },
        select: {
          id: true,
          currentOrders: true,
        },
      });

      if (!existingAgent) {
        return res.status(404).json({ error: 'Logistics agent not found' });
      }

      if (existingAgent.currentOrders > 0) {
        return res.status(400).json({
          error: 'Cannot delete logistics agent with active orders',
        });
      }

      await prisma.logisticsAgent.delete({
        where: { id: agentId },
      });

      res.json({ message: 'Logistics agent deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/logistics-provider/agents/update-status-by-phone
  async updateAgentStatusByPhone(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, isOnline } = req.body;

      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
      }

      if (typeof isOnline !== 'boolean') {
        return res.status(400).json({ error: 'isOnline must be a boolean' });
      }

      const agent = await prisma.logisticsAgent.findFirst({
        where: { phone },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Logistics agent not found' });
      }

      const updatedAgent = await prisma.logisticsAgent.update({
        where: { id: agent.id },
        data: { isOnline },
      });

      res.json({
        id: updatedAgent.id,
        name: updatedAgent.name,
        phone: updatedAgent.phone,
        isOnline: updatedAgent.isOnline,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/logistics-provider/scan/origin-warehouse
  async scanAtOriginWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const { orderId, warehouseId } = req.body;

      if (!orderId || !warehouseId) {
        return res.status(400).json({ error: 'orderId and warehouseId are required' });
      }

      // Verify order belongs to this logistics provider
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          logisticsProviderId,
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Verify warehouse belongs to this logistics provider
      const warehouse = await prisma.warehouse.findFirst({
        where: {
          id: warehouseId,
          logisticsProviderId,
        },
      });

      if (!warehouse) {
        return res.status(404).json({ error: 'Warehouse not found' });
      }

      // Update order transit status using logistics service
      await logisticsService.updateTransitStatus(
        {
          orderId,
          transitStatus: 'At Origin Warehouse',
          currentWarehouseId: warehouseId,
        },
        logisticsProviderId
      );

      res.json({
        message: 'Order scanned at origin warehouse',
        orderId,
        warehouseId,
      });
    } catch (error: any) {
      if (error.message) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  },

  // POST /api/logistics-provider/scan/destination-warehouse
  async scanAtDestinationWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const { orderId, warehouseId } = req.body;

      if (!orderId || !warehouseId) {
        return res.status(400).json({ error: 'orderId and warehouseId are required' });
      }

      // Verify order belongs to this logistics provider
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          logisticsProviderId,
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Verify warehouse belongs to this logistics provider
      const warehouse = await prisma.warehouse.findFirst({
        where: {
          id: warehouseId,
          logisticsProviderId,
        },
      });

      if (!warehouse) {
        return res.status(404).json({ error: 'Warehouse not found' });
      }

      // Update order transit status and mark as ready for pickup
      await logisticsService.updateTransitStatus(
        {
          orderId,
          transitStatus: 'At Destination Warehouse',
          currentWarehouseId: warehouseId,
        },
        logisticsProviderId
      );

      // Mark order as ready for pickup
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.READY_FOR_PICKUP,
        },
      });

      res.json({
        message: 'Order scanned at destination warehouse and marked as ready for pickup',
        orderId,
        warehouseId,
      });
    } catch (error: any) {
      if (error.message) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  },

  // GET /api/logistics-provider/warehouses
  async getWarehouses(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const warehouses = await prisma.warehouse.findMany({
        where: {
          logisticsProviderId,
        },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true,
          country: true,
          pincode: true,
          latitude: true,
          longitude: true,
          contactName: true,
          contactPhone: true,
          contactEmail: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      res.json({ warehouses });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/logistics-provider/warehouses/:id
  async getWarehouseById(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const warehouseId = req.params.id;

      const warehouse = await prisma.warehouse.findFirst({
        where: {
          id: warehouseId,
          logisticsProviderId,
        },
        include: {
          logisticsProvider: {
            select: {
              id: true,
              companyName: true,
            },
          },
        },
      });

      if (!warehouse) {
        return res.status(404).json({ error: 'Warehouse not found' });
      }

      res.json(warehouse);
    } catch (error) {
      next(error);
    }
  },

  // POST /api/logistics-provider/warehouses
  async createWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const {
        name,
        address,
        city,
        state,
        pincode,
        country,
        latitude,
        longitude,
        contactName,
        contactPhone,
        contactEmail,
        metadata,
      } = req.body;

      const warehouse = await prisma.warehouse.create({
        data: {
          logisticsProviderId,
          name,
          address,
          city: city || null,
          state: state || null,
          pincode: pincode || null,
          country: country || null,
          latitude,
          longitude,
          contactName: contactName || null,
          contactPhone: contactPhone || null,
          contactEmail: contactEmail || null,
          metadata: metadata || null,
          isActive: true,
        },
        include: {
          logisticsProvider: {
            select: {
              id: true,
              companyName: true,
            },
          },
        },
      });

      res.status(201).json(warehouse);
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/logistics-provider/warehouses/:id
  async updateWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const warehouseId = req.params.id;

      // Verify warehouse belongs to this logistics provider
      const existingWarehouse = await prisma.warehouse.findFirst({
        where: {
          id: warehouseId,
          logisticsProviderId,
        },
      });

      if (!existingWarehouse) {
        return res.status(404).json({ error: 'Warehouse not found' });
      }

      const {
        name,
        address,
        city,
        state,
        pincode,
        country,
        latitude,
        longitude,
        contactName,
        contactPhone,
        contactEmail,
        isActive,
        metadata,
      } = req.body;

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (address !== undefined) updateData.address = address;
      if (city !== undefined) updateData.city = city || null;
      if (state !== undefined) updateData.state = state || null;
      if (pincode !== undefined) updateData.pincode = pincode || null;
      if (country !== undefined) updateData.country = country || null;
      if (latitude !== undefined) updateData.latitude = latitude;
      if (longitude !== undefined) updateData.longitude = longitude;
      if (contactName !== undefined) updateData.contactName = contactName || null;
      if (contactPhone !== undefined) updateData.contactPhone = contactPhone || null;
      if (contactEmail !== undefined) updateData.contactEmail = contactEmail || null;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (metadata !== undefined) updateData.metadata = metadata || null;

      const updatedWarehouse = await prisma.warehouse.update({
        where: { id: warehouseId },
        data: updateData,
        include: {
          logisticsProvider: {
            select: {
              id: true,
              companyName: true,
            },
          },
        },
      });

      res.json(updatedWarehouse);
    } catch (error) {
      next(error);
    }
  },

  // DELETE /api/logistics-provider/warehouses/:id
  async deleteWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const warehouseId = req.params.id;

      // Verify warehouse belongs to this logistics provider
      const existingWarehouse = await prisma.warehouse.findFirst({
        where: {
          id: warehouseId,
          logisticsProviderId,
        },
      });

      if (!existingWarehouse) {
        return res.status(404).json({ error: 'Warehouse not found' });
      }

      // Check if warehouse is being used in any orders
      const ordersUsingWarehouse = await prisma.order.count({
        where: {
          OR: [
            { originWarehouseId: warehouseId },
            { currentWarehouseId: warehouseId },
            { dropWarehouseId: warehouseId },
          ],
          status: {
            notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
          },
        },
      });

      if (ordersUsingWarehouse > 0) {
        return res.status(400).json({
          error: 'Cannot delete warehouse that is being used in active orders',
        });
      }

      await prisma.warehouse.delete({
        where: { id: warehouseId },
      });

      res.json({ message: 'Warehouse deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/logistics-provider/orders/:id/transit-status
  async updateTransitStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const orderId = req.params.id;
      const { transitStatus, currentWarehouseId, expectedWarehouseArrival } = req.body;
      
      if (!transitStatus || typeof transitStatus !== 'string' || transitStatus.trim().length === 0) {
        return res.status(400).json({ 
          error: 'Validation failed',
          message: 'transitStatus is required and must be a non-empty string',
          details: [{ field: 'transitStatus', message: 'transitStatus is required' }]
        });
      }

      // Verify order belongs to this logistics provider
      const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, {
        id: orderId,
      });

      const order = await prisma.order.findFirst({
        where,
        select: { id: true },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Update transit status using logistics service
      const updatedOrder = await logisticsService.updateTransitStatus(
        {
          orderId,
          transitStatus,
          currentWarehouseId,
          expectedWarehouseArrival: expectedWarehouseArrival ? new Date(expectedWarehouseArrival) : undefined,
        },
        logisticsProviderId
      );

      res.json({
        message: 'Transit status updated successfully',
        order: updatedOrder,
      });
    } catch (error: any) {
      if (error.message) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  },

  // POST /api/logistics-provider/orders/:id/ready-for-pickup
  async markReadyForPickup(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const orderId = req.params.id;
      const { warehouseId, notes } = req.body;


      if (!warehouseId) {
        return res.status(400).json({ error: 'warehouseId is required' });
      }

      // Update transit status using logistics service
      const updatedOrder = await logisticsService.markReadyForPickup(
        orderId,
        warehouseId,
        logisticsProviderId,
        notes
      );

      res.json({
        message: 'Order marked as ready for pickup successfully',
        order: updatedOrder,
      });
    } catch (error: any) {
      if (error.message) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  },

  // PUT /api/logistics-provider/orders/:id/destination-warehouse
  async updateDestinationWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getLogisticsProviderId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const orderId = req.params.id;
      const { destinationWarehouseId } = req.body;

      if (!destinationWarehouseId) {
        return res.status(400).json({ error: 'destinationWarehouseId is required' });
      }

      // Verify order belongs to this logistics provider
      const where = await buildLogisticsProviderOrderWhere(logisticsProviderId, {
        id: orderId,
      });

      const order = await prisma.order.findFirst({
        where,
        select: {
          id: true,
          originWarehouseId: true,
          dropWarehouseId: true,
          transitLegs: true,
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found or does not belong to this logistics provider' });
      }

      // Validate that destination warehouse is different from origin
      if (order.originWarehouseId === destinationWarehouseId) {
        return res.status(400).json({ error: 'Destination warehouse must be different from origin warehouse' });
      }

      // Verify destination warehouse belongs to this logistics provider
      const warehouseOwned = await verifyWarehouseOwnership(destinationWarehouseId, logisticsProviderId);
      if (!warehouseOwned) {
        return res.status(404).json({ error: 'Destination warehouse not found or does not belong to this logistics provider' });
      }

      const destinationWarehouse = await prisma.warehouse.findUnique({
        where: { id: destinationWarehouseId },
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
        },
      });

      if (!destinationWarehouse) {
        return res.status(404).json({ error: 'Destination warehouse not found' });
      }

      // Get origin warehouse name for transit legs
      const originWarehouse = order.originWarehouseId ? await prisma.warehouse.findUnique({
        where: { id: order.originWarehouseId },
        select: { name: true },
      }) : null;

      // Update transit legs - update Leg 2 with new destination warehouse
      const existingLegs: any[] = Array.isArray(order.transitLegs) ? (order.transitLegs as any) : [];
      const updatedLegs = [...existingLegs];
      
      // Find and update Leg 2
      let leg2 = updatedLegs.find((leg: any) => leg.leg === 2);
      if (leg2) {
        leg2.destinationWarehouseId = destinationWarehouseId;
        leg2.destinationWarehouseName = destinationWarehouse.name;
        leg2.to = destinationWarehouse.name;
        leg2.updatedAt = new Date().toISOString();
        const leg2Index = updatedLegs.findIndex((leg: any) => leg.leg === 2);
        if (leg2Index >= 0) {
          updatedLegs[leg2Index] = leg2;
        }
      } else {
        // Create Leg 2 if it doesn't exist
        updatedLegs.push({
          leg: 2,
          from: originWarehouse?.name || 'ORIGIN_WAREHOUSE',
          to: destinationWarehouse.name,
          status: 'PENDING',
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          originWarehouseId: order.originWarehouseId,
          destinationWarehouseId: destinationWarehouseId,
          originWarehouseName: originWarehouse?.name,
          destinationWarehouseName: destinationWarehouse.name,
        });
      }

      // Update the order's dropWarehouseId and related fields
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          dropWarehouseId: destinationWarehouseId,
          dropLat: destinationWarehouse.latitude,
          dropLng: destinationWarehouse.longitude,
          dropAddressText: `${destinationWarehouse.name}, ${destinationWarehouse.address}`,
          transitLegs: updatedLegs as any,
          updatedAt: new Date(),
        },
        include: {
          dropWarehouse: {
            select: {
              id: true,
              name: true,
              address: true,
            },
          },
        },
      });

      res.json({
        message: 'Destination warehouse updated successfully',
        order: updatedOrder,
      });
    } catch (error: any) {
      if (error.message) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  },
};
