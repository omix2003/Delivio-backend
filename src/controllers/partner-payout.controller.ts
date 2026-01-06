import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { getPartnerId } from '../utils/role.util';
import { AppError } from '../utils/errors.util';

/**
 * Partner Payout Controller
 * Partners track their payouts (orderAmount they paid for orders), not revenue
 */
export const partnerPayoutController = {
  /**
   * GET /api/partner/payouts/summary
   * Get partner payout summary (total amount paid for orders)
   */
  async getPayoutSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        throw new AppError('Partner ID not found', 401);
      }

      const { startDate, endDate } = req.query;
      const where: any = {
        partnerId,
        status: 'DELIVERED',
      };

      if (startDate || endDate) {
        where.deliveredAt = {};
        if (startDate) where.deliveredAt.gte = new Date(startDate as string);
        if (endDate) where.deliveredAt.lte = new Date(endDate as string);
      }

      // Get all delivered orders for this partner
      const orders = await prisma.order.findMany({
        where,
        select: {
          id: true,
          orderAmount: true,
          payoutAmount: true,
          deliveredAt: true,
          status: true,
        },
      });

      // Calculate totals using 70/30 split
      const totalPayouts = orders.reduce((sum, order) => {
        // Partner pays orderAmount (100%), or calculate from payoutAmount
        let partnerPayment = order.orderAmount;
        if (!partnerPayment && order.payoutAmount) {
          partnerPayment = order.payoutAmount / 0.70; // payoutAmount is 70% of orderAmount
        }
        return sum + (partnerPayment || 0);
      }, 0);

      const totalOrders = orders.length;
      const completedOrders = orders.filter(o => o.status === 'DELIVERED').length;
      const averageOrderValue = totalOrders > 0 ? totalPayouts / totalOrders : 0;

      res.json({
        totalPayouts,
        totalOrders,
        completedOrders,
        averageOrderValue,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/partner/payouts
   * Get partner payout records (orders they paid for)
   */
  async getPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        throw new AppError('Partner ID not found', 401);
      }

      const { startDate, endDate, page = '1', limit = '20' } = req.query;
      const where: any = {
        partnerId,
        status: 'DELIVERED',
      };

      if (startDate || endDate) {
        where.deliveredAt = {};
        if (startDate) where.deliveredAt.gte = new Date(startDate as string);
        if (endDate) where.deliveredAt.lte = new Date(endDate as string);
      }

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          select: {
            id: true,
            orderAmount: true,
            payoutAmount: true,
            deliveredAt: true,
            status: true,
            createdAt: true,
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
          orderBy: {
            deliveredAt: 'desc',
          },
          skip,
          take: limitNum,
        }),
        prisma.order.count({ where }),
      ]);

      // Format payouts with calculated amounts
      const payouts = orders.map(order => {
        let partnerPayment = order.orderAmount;
        if (!partnerPayment && order.payoutAmount) {
          partnerPayment = order.payoutAmount / 0.70;
        }

        return {
          id: order.id,
          orderId: order.id,
          amount: partnerPayment || 0, // What partner paid
          agentPayout: order.payoutAmount || (partnerPayment ? partnerPayment * 0.70 : 0), // What agent got (70%)
          platformFee: partnerPayment ? partnerPayment * 0.30 : 0, // What platform got (30%)
          deliveredAt: order.deliveredAt,
          createdAt: order.createdAt,
          agent: order.agent,
        };
      });

      res.json({
        payouts,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (error) {
      next(error);
    }
  },
};

