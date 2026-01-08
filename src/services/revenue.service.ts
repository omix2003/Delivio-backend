import { prisma } from '../lib/prisma';
import { OrderStatus, Prisma } from '@prisma/client';

export interface RevenueCalculation {
  orderAmount: number;      // Total amount partner charges customer
  deliveryFee: number;       // Amount paid to agent
  platformFee: number;       // Platform commission/fee
  netRevenue: number;        // Partner: orderAmount - deliveryFee - platformFee | Platform: platformFee
}

export interface RevenueSummary {
  totalRevenue: number;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  averageOrderValue: number;
  platformFees: number;
  agentPayouts: number;
}

export const revenueService = {
  /**
   * Calculate revenue for a delivered order
   * Business Rules:
   * - partnerPayment = total fee the partner pays for that order (orderAmount) = 100%
   * - agentPayout = 70% of partnerPayment
   * - adminCommission = 30% of partnerPayment
   * - Formula: adminCommission = partnerPayment - agentPayout
   */
  calculateOrderRevenue: async (orderId: string, tx?: Prisma.TransactionClient): Promise<RevenueCalculation> => {
    const client = tx || prisma;
    const order = await client.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status !== 'DELIVERED') {
      throw new Error('Order must be delivered to calculate revenue');
    }

    // Partner payment = what partner pays for the order (100%)
    // If orderAmount is not set, calculate from payoutAmount (payoutAmount is 70% of orderAmount)
    // So: orderAmount = payoutAmount / 0.70
    let partnerPayment = order.orderAmount || 0;
    if (!partnerPayment && order.payoutAmount) {
      partnerPayment = order.payoutAmount / 0.70;
    }

    // If still no partnerPayment, default to a minimum (this shouldn't happen in production)
    if (!partnerPayment || partnerPayment <= 0) {
      console.warn(`[Revenue Service] Order ${orderId.substring(0, 8)} has no orderAmount or payoutAmount. Using default calculation.`);
      // Try to use payoutAmount if available, otherwise use a default
      if (order.payoutAmount && order.payoutAmount > 0) {
        partnerPayment = order.payoutAmount / 0.70;
      } else {
        throw new Error(`Order ${orderId.substring(0, 8)} has no valid orderAmount or payoutAmount`);
      }
    }

    // Validate consistency between orderAmount and payoutAmount if both exist
    if (order.orderAmount && order.payoutAmount) {
      const expectedPayoutAmount = order.orderAmount * 0.70;
      const tolerance = 0.01; // Allow 1 cent tolerance for rounding
      const difference = Math.abs(order.payoutAmount - expectedPayoutAmount);
      
      if (difference > tolerance) {
        console.warn(
          `[Revenue Service] Order ${orderId.substring(0, 8)} has inconsistent amounts. ` +
          `orderAmount: ${order.orderAmount}, payoutAmount: ${order.payoutAmount}, expected: ${expectedPayoutAmount.toFixed(2)}`
        );
        // Use orderAmount as source of truth and recalculate payoutAmount
        partnerPayment = order.orderAmount;
      }
    }

    // Calculate expected values based on 70/30 split
    const expectedAgentPayout = partnerPayment * 0.70;
    const expectedAdminCommission = partnerPayment * 0.30;

    // Use expected values for consistency (ignore stored payoutAmount if inconsistent)
    const agentPayout = expectedAgentPayout;
    const adminCommission = expectedAdminCommission;

    return {
      orderAmount: partnerPayment,           // What partner pays (100%)
      deliveryFee: expectedAgentPayout,      // What agent gets (70%)
      platformFee: expectedAdminCommission, // What admin/platform gets (30%)
      netRevenue: 0,                         // Partner doesn't earn, they pay
    };
  },

  /**
   * Create partner revenue record
   * Note: Partner PAYS for orders, they don't earn revenue
   */
  createPartnerRevenue: async (
    partnerId: string,
    orderId: string,
    periodStart: Date,
    periodEnd: Date,
    periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY',
    tx?: Prisma.TransactionClient
  ) => {
    const client = tx || prisma;
    const calculation = await revenueService.calculateOrderRevenue(orderId, client);

    // Check if revenue record already exists
    const existing = await client.partnerRevenue.findUnique({
      where: { orderId },
    });

    if (existing) {
      return await client.partnerRevenue.update({
        where: { id: existing.id },
        data: {
          orderAmount: calculation.orderAmount,      // What partner paid
          deliveryFee: calculation.deliveryFee,      // What agent got
          platformFee: calculation.platformFee,      // What platform got
          netRevenue: -calculation.orderAmount,      // Negative (partner pays, doesn't earn)
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });
    }

    return await client.partnerRevenue.create({
      data: {
        partnerId,
        orderId,
        orderAmount: calculation.orderAmount,      // What partner paid
        deliveryFee: calculation.deliveryFee,      // What agent got
        platformFee: calculation.platformFee,      // What platform got
        netRevenue: -calculation.orderAmount,      // Negative (partner pays, doesn't earn)
        periodStart,
        periodEnd,
        periodType,
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    });
  },

  /**
   * Create platform revenue record
   * Admin commission = partnerPayment - agentPayout
   */
  createPlatformRevenue: async (
    orderId: string,
    partnerId: string,
    agentId: string | null,
    periodStart: Date,
    periodEnd: Date,
    periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY',
    tx?: Prisma.TransactionClient
  ) => {
    const client = tx || prisma;
    const calculation = await revenueService.calculateOrderRevenue(orderId, client);

    // Check if revenue record already exists
    const existing = await client.platformRevenue.findUnique({
      where: { orderId },
    });

    if (existing) {
      return await client.platformRevenue.update({
        where: { id: existing.id },
        data: {
          orderAmount: calculation.orderAmount,      // Partner payment
          platformFee: calculation.platformFee,      // Admin commission (partnerPayment - agentPayout)
          agentPayout: calculation.deliveryFee,      // Agent payout
          netRevenue: calculation.platformFee,       // Platform keeps the commission
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });
    }

    return await client.platformRevenue.create({
      data: {
        orderId,
        partnerId,
        agentId: agentId || null,
        orderAmount: calculation.orderAmount,      // Partner payment
        platformFee: calculation.platformFee,      // Admin commission (partnerPayment - agentPayout)
        agentPayout: calculation.deliveryFee,      // Agent payout
        netRevenue: calculation.platformFee,       // Platform keeps the commission
        revenueType: 'COMMISSION',
        periodStart,
        periodEnd,
        periodType,
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    });
  },

  /**
   * Get partner revenue summary
   */
  getPartnerRevenueSummary: async (
    partnerId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<RevenueSummary> => {
    try {
      const where: any = {
        partnerId,
        status: 'PROCESSED',
      };

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      const revenues = await prisma.partnerRevenue.findMany({
        where,
        select: {
          netRevenue: true,
          platformFee: true,
          deliveryFee: true,
          order: {
            select: {
              status: true,
            },
          },
        },
      });

      const totalRevenue = revenues.reduce((sum, r) => sum + r.netRevenue, 0);
      const totalOrders = revenues.length;
      const completedOrders = revenues.filter(r => r.order.status === 'DELIVERED').length;
      const cancelledOrders = revenues.filter(r => r.order.status === 'CANCELLED').length;
      const platformFees = revenues.reduce((sum, r) => sum + r.platformFee, 0);
      const agentPayouts = revenues.reduce((sum, r) => sum + r.deliveryFee, 0);
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      return {
        totalRevenue,
        totalOrders,
        completedOrders,
        cancelledOrders,
        averageOrderValue,
        platformFees,
        agentPayouts,
      };
    } catch (error: any) {
      // Handle missing PartnerRevenue table
      if (error.code === 'P2021' || error.code === '42P01' || error.message?.includes('does not exist')) {
        console.warn('[Revenue] PartnerRevenue table does not exist, returning default values');
        return {
          totalRevenue: 0,
          totalOrders: 0,
          completedOrders: 0,
          cancelledOrders: 0,
          averageOrderValue: 0,
          platformFees: 0,
          agentPayouts: 0,
        };
      }
      throw error;
    }
  },

  /**
   * Get platform revenue summary
   */
  getPlatformRevenueSummary: async (
    startDate?: Date,
    endDate?: Date
  ): Promise<RevenueSummary> => {
    const where: any = {
      status: 'PROCESSED',
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const revenues = await prisma.platformRevenue.findMany({
      where,
      include: {
        order: {
          select: {
            status: true,
          },
        },
      },
    });

    const totalRevenue = revenues.reduce((sum, r) => sum + r.netRevenue, 0);
    const totalOrders = revenues.length;
    const completedOrders = revenues.filter(r => r.order.status === 'DELIVERED').length;
    const cancelledOrders = revenues.filter(r => r.order.status === 'CANCELLED').length;
    const platformFees = totalRevenue; // Platform revenue is the fees
    const agentPayouts = revenues.reduce((sum, r) => sum + r.agentPayout, 0);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return {
      totalRevenue,
      totalOrders,
      completedOrders,
      cancelledOrders,
      averageOrderValue,
      platformFees,
      agentPayouts,
    };
  },

  /**
   * Get partner revenue by period
   */
  getPartnerRevenueByPeriod: async (
    partnerId: string,
    periodStart: Date,
    periodEnd: Date,
    periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  ) => {
    try {
      return await prisma.partnerRevenue.findMany({
        where: {
          partnerId,
          periodStart: { gte: periodStart },
          periodEnd: { lte: periodEnd },
          periodType,
          status: 'PROCESSED',
        },
        select: {
          id: true,
          partnerId: true,
          orderId: true,
          orderAmount: true,
          deliveryFee: true,
          platformFee: true,
          netRevenue: true,
          periodStart: true,
          periodEnd: true,
          periodType: true,
          status: true,
          processedAt: true,
          createdAt: true,
          updatedAt: true,
          order: {
            select: {
              id: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    } catch (error: any) {
      // Handle missing PartnerRevenue table
      if (error.code === 'P2021' || error.code === '42P01' || error.message?.includes('does not exist')) {
        console.warn('[Revenue] PartnerRevenue table does not exist, returning empty array');
        return [];
      }
      throw error;
    }
  },

  /**
   * Get platform revenue by period
   */
  getPlatformRevenueByPeriod: async (
    periodStart: Date,
    periodEnd: Date,
    periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  ) => {
    return await prisma.platformRevenue.findMany({
      where: {
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
        periodType,
        status: 'PROCESSED',
      },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
        },
        partner: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  },

  /**
   * Reverse platform revenue (for cancelled delivered orders)
   */
  reversePlatformRevenue: async (
    orderId: string,
    tx?: Prisma.TransactionClient
  ) => {
    const client = tx || prisma;
    
    // Find existing platform revenue record
    const existing = await client.platformRevenue.findUnique({
      where: { orderId },
    });

    if (!existing || existing.status !== 'PROCESSED') {
      // No revenue to reverse
      return null;
    }

    // Mark as reversed
    return await client.platformRevenue.update({
      where: { id: existing.id },
      data: {
        status: 'REVERSED',
        processedAt: new Date(),
      },
    });
  },
};

