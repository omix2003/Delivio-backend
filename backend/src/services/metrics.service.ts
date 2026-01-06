/**
 * Metrics Service
 * Centralizes all metrics-related business logic
 */

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export const metricsService = {
  /**
   * Get overview metrics for admin dashboard
   */
  async getOverviewMetrics() {
    try {
      const now = new Date();
      const todayStart = new Date(now.setHours(0, 0, 0, 0));
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        totalAgents,
        totalPartners,
        totalOrders,
        activeAgents,
        onlineAgents,
        onTripAgents,
        todayOrders,
        thisMonthOrders,
        pendingOrders,
        completedOrders,
        activePartners,
      ] = await Promise.all([
        prisma.agent.count(),
        prisma.partner.count(),
        prisma.order.count(),
        prisma.agent.count({
          where: {
            status: { in: ['ONLINE', 'ON_TRIP'] },
            isApproved: true,
          },
        }),
        prisma.agent.count({
          where: { status: 'ONLINE' },
        }),
        prisma.agent.count({
          where: { status: 'ON_TRIP' },
        }),
        prisma.order.count({
          where: {
            createdAt: { gte: todayStart },
          },
        }),
        prisma.order.count({
          where: {
            createdAt: { gte: thisMonthStart },
          },
        }),
        prisma.order.count({
          where: { status: 'SEARCHING_AGENT' },
        }),
        prisma.order.count({
          where: { status: 'DELIVERED' },
        }),
        prisma.partner.count({
          where: { isActive: true },
        }),
      ]);

      return {
        totalAgents,
        totalPartners,
        totalOrders,
        activeAgents,
        onlineAgents,
        onTripAgents,
        todayOrders,
        thisMonthOrders,
        pendingOrders,
        completedOrders,
        activePartners,
      };
    } catch (error) {
      logger.error('Failed to get overview metrics', error);
      throw error;
    }
  },

  /**
   * Get order metrics for a date range
   */
  async getOrderMetrics(startDate: Date, endDate: Date) {
    try {
      // Orders by status
      const ordersByStatus = await prisma.order.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        _count: true,
      });

      // Orders over time (daily)
      const ordersOverTime = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT 
          DATE("createdAt") as date,
          COUNT(*) as count
        FROM "Order"
        WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `;

      // Revenue (sum of payout amounts)
      const revenue = await prisma.order.aggregate({
        where: {
          status: 'DELIVERED',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          payoutAmount: true,
        },
      });

      return {
        ordersByStatus: ordersByStatus.map((item) => ({
          status: item.status,
          count: item._count,
        })),
        ordersOverTime: ordersOverTime.map((item) => ({
          date: item.date,
          count: Number(item.count),
        })),
        totalRevenue: revenue._sum.payoutAmount || 0,
        period: { start: startDate, end: endDate },
      };
    } catch (error) {
      logger.error('Failed to get order metrics', error);
      throw error;
    }
  },

  /**
   * Get agent metrics
   */
  async getAgentMetrics() {
    try {
      const [
        agentsByStatus,
        agentsByVehicleType,
        averageRating,
        totalCompletedOrders,
      ] = await Promise.all([
        prisma.agent.groupBy({
          by: ['status'],
          _count: true,
        }),
        prisma.agent.groupBy({
          by: ['vehicleType'],
          _count: true,
        }),
        prisma.agent.aggregate({
          _avg: {
            rating: true,
          },
          where: {
            rating: { not: null },
          },
        }),
        prisma.agent.aggregate({
          _sum: {
            completedOrders: true,
          },
        }),
      ]);

      return {
        agentsByStatus: agentsByStatus.map((item) => ({
          status: item.status,
          count: item._count,
        })),
        agentsByVehicleType: agentsByVehicleType.map((item) => ({
          vehicleType: item.vehicleType,
          count: item._count,
        })),
        averageRating: averageRating._avg.rating || 0,
        totalCompletedOrders: totalCompletedOrders._sum.completedOrders || 0,
      };
    } catch (error) {
      logger.error('Failed to get agent metrics', error);
      throw error;
    }
  },

  /**
   * Get metrics by category (with full details)
   */
  async getMetricsByCategory(startDate: Date, endDate: Date) {
    try {
      // Try to get detailed category metrics
      let ordersByCategory: any[];
      let totals: any;
      try {
        const orderModel = prisma.order as any;
        [ordersByCategory, totals] = await Promise.all([
          orderModel.groupBy({
            by: ['partnerCategory'],
            where: {
              createdAt: { gte: startDate, lte: endDate },
              partnerCategory: { not: null },
            },
            _count: true,
            _sum: {
              partnerPayment: true,
              agentPayout: true,
              adminCommission: true,
            },
            _avg: {
              partnerPayment: true,
              distanceKm: true,
            },
          }),
          orderModel.aggregate({
            where: {
              createdAt: { gte: startDate, lte: endDate },
              partnerCategory: { not: null },
            },
            _sum: {
              partnerPayment: true,
              agentPayout: true,
              adminCommission: true,
            },
            _count: true,
          }),
        ]);
      } catch (error: any) {
        // If columns don't exist (P2022), return empty metrics
        if (error?.code === 'P2022' || error?.message?.includes('does not exist') ||
          error?.message?.includes('partnerCategory') || error?.message?.includes('partnerPayment')) {
          logger.warn('Database schema error: Category metrics columns may not exist yet');
          return {
            byCategory: [],
            totals: {
              totalOrders: 0,
              totalPartnerPayment: 0,
              totalAgentPayout: 0,
              totalAdminCommission: 0,
            },
            period: { start: startDate, end: endDate },
            note: 'Category metrics require database migration. Please run: npx prisma migrate dev',
          };
        }
        throw error;
      }

      // Format response
      const categoryMetrics = ordersByCategory
        .filter((item) => item.partnerCategory !== null)
        .map((item) => {
          const sum = item._sum || {};
          const avg = item._avg || {};
          const partnerPayment = sum.partnerPayment || 0;
          const adminCommission = sum.adminCommission || 0;

          return {
            category: item.partnerCategory!,
            orderCount: item._count,
            totalPartnerPayment: partnerPayment,
            totalAgentPayout: sum.agentPayout || 0,
            totalAdminCommission: adminCommission,
            avgTicket: avg.partnerPayment || 0,
            avgDistance: avg.distanceKm || 0,
            avgCommissionPct: partnerPayment > 0 && adminCommission > 0
              ? (adminCommission / partnerPayment) * 100
              : 0,
          };
        });

      const totalsSum = totals._sum || {};

      return {
        byCategory: categoryMetrics,
        totals: {
          totalOrders: totals._count || 0,
          totalPartnerPayment: totalsSum.partnerPayment || 0,
          totalAgentPayout: totalsSum.agentPayout || 0,
          totalAdminCommission: totalsSum.adminCommission || 0,
        },
        period: { start: startDate, end: endDate },
      };
    } catch (error) {
      logger.error('Failed to get category metrics', error);
      throw error;
    }
  },

  /**
   * Get recent activity with formatted descriptions
   * ✅ FIXED: Batch queries to avoid N+1 problem
   */
  async getRecentActivity(limit: number = 20) {
    try {
      const events = await prisma.appEvent.findMany({
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      });

      // ✅ FIXED: Batch fetch all entities to avoid N+1 queries
      const orderIds = events.filter((e) => e.entityType === 'ORDER' && e.entityId).map((e) => e.entityId!);
      const agentIds = events.filter((e) => e.entityType === 'AGENT' && e.entityId).map((e) => e.entityId!);
      const partnerIds = events.filter((e) => e.entityType === 'PARTNER' && e.entityId).map((e) => e.entityId!);

      const [orders, agents, partners] = await Promise.all([
        orderIds.length > 0
          ? prisma.order.findMany({
              where: { id: { in: orderIds } },
              select: { id: true },
            })
          : [],
        agentIds.length > 0
          ? prisma.agent.findMany({
              where: { id: { in: agentIds } },
              include: { user: { select: { name: true } } },
            })
          : [],
        partnerIds.length > 0
          ? prisma.partner.findMany({
              where: { id: { in: partnerIds } },
              include: { user: { select: { name: true } } },
            })
          : [],
      ]);

      // Create lookup maps
      const orderMap = new Map(orders.map((o) => [o.id, o]));
      const agentMap = new Map(agents.map((a) => [a.id, a]));
      const partnerMap = new Map(partners.map((p) => [p.id, p]));

      // Format events
      return events.map((event) => {
        let description = '';
        let color = 'gray';

        switch (event.eventType) {
          case 'AGENT_ONLINE':
            description = 'Agent went online';
            color = 'green';
            break;
          case 'AGENT_OFFLINE':
            description = 'Agent went offline';
            color = 'gray';
            break;
          case 'ORDER_CREATED':
            description = 'New order created';
            color = 'blue';
            break;
          case 'ORDER_ASSIGNED':
            description = 'Order assigned to agent';
            color = 'purple';
            break;
          case 'ORDER_ACCEPTED':
            description = 'Order accepted by agent';
            color = 'blue';
            break;
          case 'ORDER_REJECTED':
            description = 'Order rejected by agent';
            color = 'orange';
            break;
          case 'ORDER_PICKED_UP':
            description = 'Order picked up';
            color = 'yellow';
            break;
          case 'ORDER_OUT_FOR_DELIVERY':
            description = 'Order out for delivery';
            color = 'blue';
            break;
          case 'ORDER_DELIVERED':
            description = 'Order delivered';
            color = 'green';
            break;
          case 'ORDER_CANCELLED':
            description = 'Order cancelled';
            color = 'red';
            break;
          case 'AGENT_LOCATION_UPDATE':
            description = 'Agent location updated';
            color = 'blue';
            break;
          default:
            description = 'System event';
        }

        // Get entity name from lookup maps
        let entityName = '';
        if (event.entityType === 'ORDER' && event.entityId) {
          const order = orderMap.get(event.entityId);
          if (order) {
            entityName = `Order #${order.id.slice(-6).toUpperCase()}`;
          }
        } else if (event.entityType === 'AGENT' && event.entityId) {
          const agent = agentMap.get(event.entityId);
          if (agent) {
            entityName = agent.user?.name || '';
          }
        } else if (event.entityType === 'PARTNER' && event.entityId) {
          const partner = partnerMap.get(event.entityId);
          if (partner) {
            entityName = partner.user?.name || '';
          }
        }

        return {
          id: event.id,
          description: entityName ? `${description}: ${entityName}` : description,
          type: event.eventType,
          actorType: event.actorType,
          entityType: event.entityType,
          entityId: event.entityId,
          color,
          createdAt: event.createdAt,
          metadata: event.metadata,
        };
      });
    } catch (error) {
      logger.error('Failed to get recent activity', error);
      throw error;
    }
  },
};

