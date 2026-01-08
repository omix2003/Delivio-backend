import { prisma } from '../lib/prisma';
import { PartnerCategory } from '@prisma/client';
import { logger } from '../lib/logger';

/**
 * Partner Wallet Service - Handles wallet-based billing for LOCAL_STORE partners
 * 
 * WALLET BILLING RULES:
 * - Order creation blocked if wallet balance < minimum
 * - Each delivery deducts immediately from wallet
 * - Optional weekly invoice for reconciliation
 */

export const partnerWalletService = {
  /**
   * Get or create wallet for a partner
   */
  async getOrCreateWallet(partnerId: string) {
    let wallet = await prisma.partnerWallet.findUnique({
      where: { partnerId },
    });

    if (!wallet) {
      // Create wallet (Prisma will auto-generate ID using cuid)
      wallet = await prisma.partnerWallet.create({
        data: {
          partnerId,
          balance: 0,
          reserved: 0,
        },
      });
    }

    return wallet;
  },

  /**
   * Check if partner can create order (wallet balance check)
   */
  async canCreateOrder(partnerId: string, orderAmount: number): Promise<{
    allowed: boolean;
    reason?: string;
    currentBalance: number;
    requiredBalance: number;
  }> {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      include: {
        billingConfig: true,
        wallet: true,
      },
    });

    if (!partner) {
      throw new Error('Partner not found');
    }

    // Only check for LOCAL_STORE with wallet billing
    if (partner.category !== PartnerCategory.LOCAL_STORE) {
      return {
        allowed: true,
        currentBalance: 0,
        requiredBalance: 0,
      };
    }

    if (!partner.billingConfig || partner.billingConfig.billingMode !== 'WALLET') {
      return {
        allowed: true,
        currentBalance: 0,
        requiredBalance: 0,
      };
    }

    const wallet = partner.wallet || await this.getOrCreateWallet(partnerId);
    const minBalance = partner.billingConfig.minWalletBalance || 0;
    const availableBalance = wallet.balance - wallet.reserved;
    const requiredBalance = orderAmount + minBalance;

    if (availableBalance < requiredBalance) {
      return {
        allowed: false,
        reason: `Insufficient wallet balance. Available: ${availableBalance}, Required: ${requiredBalance}`,
        currentBalance: availableBalance,
        requiredBalance,
      };
    }

    return {
      allowed: true,
      currentBalance: availableBalance,
      requiredBalance,
    };
  },

  /**
   * Deduct from wallet when order is delivered
   * Called automatically when order status changes to DELIVERED
   */
  async deductOnDelivery(orderId: string): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        partner: {
          include: {
            billingConfig: true,
            wallet: true,
          },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Only deduct for LOCAL_STORE with wallet billing
    if (order.partner.category !== PartnerCategory.LOCAL_STORE) {
      return; // Not wallet-based billing
    }

    if (!order.partner.billingConfig || order.partner.billingConfig.billingMode !== 'WALLET') {
      return; // Not wallet-based billing
    }

    const wallet = order.partner.wallet || await this.getOrCreateWallet(order.partnerId);
    const charge = (order.partnerCharge || 0) + (order.isRTO && order.rtoCharge ? order.rtoCharge : 0);

    if (charge <= 0) {
      logger.warn(`Order ${orderId} has no charge to deduct from wallet`);
      return;
    }

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Reload wallet to get latest balance
      const currentWallet = await tx.partnerWallet.findUnique({
        where: { id: wallet.id },
      });

      if (!currentWallet) {
        throw new Error('Wallet not found');
      }

      const balanceBefore = currentWallet.balance;
      const balanceAfter = balanceBefore - charge;

      if (balanceAfter < 0) {
        throw new Error(`Insufficient wallet balance. Current: ${balanceBefore}, Charge: ${charge}`);
      }

      // Update wallet balance
      await tx.partnerWallet.update({
        where: { id: wallet.id },
        data: {
          balance: balanceAfter,
        },
      });

      // Create transaction record (Prisma will auto-generate ID using cuid)
      await tx.partnerWalletTransaction.create({
        data: {
          partnerId: order.partnerId,
          walletId: wallet.id,
          orderId: order.id,
          type: 'DEDUCTION',
          amount: charge,
          balanceBefore,
          balanceAfter,
          description: `Order delivery: ${order.id.substring(0, 12).toUpperCase()}`,
          metadata: {
            orderId: order.id,
            serviceType: order.logisticsProviderId ? 'Multi-leg' : 'Single-leg',
            isRTO: order.isRTO || false,
          } as any,
        },
      });
    });

    logger.info(`Deducted ${charge} from wallet for order ${orderId}. New balance: ${wallet.balance - charge}`);
  },

  /**
   * Top up wallet
   */
  async topUp(partnerId: string, amount: number, description?: string): Promise<any> {
    if (amount <= 0) {
      throw new Error('Top-up amount must be positive');
    }

    const wallet = await this.getOrCreateWallet(partnerId);

    return await prisma.$transaction(async (tx) => {
      const currentWallet = await tx.partnerWallet.findUnique({
        where: { id: wallet.id },
      });

      if (!currentWallet) {
        throw new Error('Wallet not found');
      }

      const balanceBefore = currentWallet.balance;
      const balanceAfter = balanceBefore + amount;

      // Update wallet
      const updatedWallet = await tx.partnerWallet.update({
        where: { id: wallet.id },
        data: {
          balance: balanceAfter,
          lastTopUpAt: new Date(),
          lastTopUpAmount: amount,
        },
      });

      // Create transaction record (Prisma will auto-generate ID using cuid)
      await tx.partnerWalletTransaction.create({
        data: {
          partnerId,
          walletId: wallet.id,
          type: 'TOPUP',
          amount,
          balanceBefore,
          balanceAfter,
          description: description || `Wallet top-up: ₹${amount}`,
        },
      });

      return updatedWallet;
    });
  },

  /**
   * Get wallet balance and transaction history
   */
  async getWalletDetails(partnerId: string, limit: number = 50) {
    const wallet = await this.getOrCreateWallet(partnerId);

    const transactions = await prisma.partnerWalletTransaction.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        order: {
          select: {
            id: true,
            deliveredAt: true,
          },
        },
      },
    });

    return {
      wallet,
      transactions,
      summary: {
        totalTopUps: transactions
          .filter((t) => t.type === 'TOPUP')
          .reduce((sum, t) => sum + t.amount, 0),
        totalDeductions: transactions
          .filter((t) => t.type === 'DEDUCTION')
          .reduce((sum, t) => sum + t.amount, 0),
        transactionCount: transactions.length,
      },
    };
  },

  /**
   * Reserve amount for pending order (optional - for order creation)
   */
  async reserveAmount(partnerId: string, amount: number, orderId: string): Promise<void> {
    const wallet = await this.getOrCreateWallet(partnerId);

    await prisma.partnerWallet.update({
      where: { id: wallet.id },
      data: {
        reserved: {
          increment: amount,
        },
      },
    });
  },

  /**
   * Release reserved amount (when order is cancelled)
   */
  async releaseReserved(partnerId: string, amount: number): Promise<void> {
    const wallet = await this.getOrCreateWallet(partnerId);

    await prisma.partnerWallet.update({
      where: { id: wallet.id },
      data: {
        reserved: {
          decrement: amount,
        },
      },
    });
  },
};

