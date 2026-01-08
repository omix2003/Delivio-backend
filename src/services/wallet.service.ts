import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export interface WalletBalance {
  balance: number;
  totalEarned: number;
  totalPaidOut: number;
}

export const walletService = {
  /**
   * Get or create admin wallet (singleton)
   */
  async getAdminWallet(tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    try {
      let wallet = await client.adminWallet.findFirst();

      if (!wallet) {
        wallet = await client.adminWallet.create({
          data: {
            balance: 0,
            totalDeposited: 0,
            totalPaidOut: 0,
          },
        });
      }

      return wallet;
    } catch (error: any) {
      // If table doesn't exist, return a default wallet object
      if (error?.code === 'P2021' || error?.code === '42P01' || error?.message?.includes('does not exist')) {
        console.warn('⚠️  AdminWallet table does not exist - returning default wallet');
        return {
          id: 'default',
          balance: 0,
          totalDeposited: 0,
          totalPaidOut: 0,
          lastUpdated: new Date(),
          createdAt: new Date(),
        };
      }
      throw error;
    }
  },

  /**
   * Get or create agent wallet
   */
  async getAgentWallet(agentId: string, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    try {
      let wallet = await client.agentWallet.findUnique({
        where: { agentId },
      });

      if (!wallet) {
        // Get agent to check payout plan
        const agent = await client.agent.findUnique({
          where: { id: agentId },
          select: { payoutPlan: true },
        });

        // Calculate next payout date based on plan
        const nextPayoutDate = agent?.payoutPlan === 'MONTHLY'
          ? getNextMonthStart()
          : getNextMonday();

        wallet = await client.agentWallet.create({
          data: {
            agentId,
            balance: 0,
            totalEarned: 0,
            totalPaidOut: 0,
            nextPayoutDate: nextPayoutDate,
          },
        });
      }

      return wallet;
    } catch (error: any) {
      // If table doesn't exist, return a default wallet object
      if (error?.code === 'P2021' || error?.code === '42P01' || error?.message?.includes('does not exist')) {
        console.warn('⚠️  AgentWallet table does not exist - returning default wallet');
        const nextMonday = getNextMonday();
        return {
          id: 'default',
          agentId,
          balance: 0,
          totalEarned: 0,
          totalPaidOut: 0,
          lastPayoutDate: null,
          nextPayoutDate: nextMonday,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      throw error;
    }
  },

  /**
   * Credit agent wallet (when order is delivered)
   */
  async creditAgentWallet(agentId: string, amount: number, orderId: string, description?: string, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    
    // Check if transaction already exists for this order (idempotency)
    const existingTransaction = await client.walletTransaction.findFirst({
      where: {
        orderId,
        walletType: 'AGENT_WALLET',
        type: 'EARNING',
        status: 'COMPLETED',
      },
    });

    if (existingTransaction) {
      // Already credited, return existing wallet
      return await walletService.getAgentWallet(agentId, client);
    }

    const wallet = await walletService.getAgentWallet(agentId, client);
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;

    // Validate amount is positive
    if (amount <= 0) {
      throw new Error(`Invalid credit amount: ${amount}. Amount must be greater than 0.`);
    }

    // Update wallet
    const updatedWallet = await client.agentWallet.update({
      where: { agentId },
      data: {
        balance: Math.max(0, balanceAfter), // Ensure balance never goes negative
        totalEarned: wallet.totalEarned + amount,
      },
    });

    // Create transaction record
    await client.walletTransaction.create({
      data: {
        walletType: 'AGENT_WALLET',
        agentWalletId: wallet.id,
        orderId,
        amount,
        type: 'EARNING',
        description: description || `Earning from order ${orderId.substring(0, 8).toUpperCase()}`,
        balanceBefore,
        balanceAfter,
        status: 'COMPLETED',
      },
    });

    return updatedWallet;
  },

  /**
   * Credit admin wallet (when platform receives commission)
   */
  async creditAdminWallet(amount: number, orderId: string, description?: string, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    
    // Check if transaction already exists for this order (idempotency)
    const existingTransaction = await client.walletTransaction.findFirst({
      where: {
        orderId,
        walletType: 'ADMIN_WALLET',
        type: 'COMMISSION',
        status: 'COMPLETED',
      },
    });

    if (existingTransaction) {
      // Already credited, return existing wallet
      return await walletService.getAdminWallet(client);
    }

    const wallet = await walletService.getAdminWallet(client);
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;

    // Validate amount is positive
    if (amount <= 0) {
      throw new Error(`Invalid credit amount: ${amount}. Amount must be greater than 0.`);
    }

    // Update wallet
    const updatedWallet = await client.adminWallet.update({
      where: { id: wallet.id },
      data: {
        balance: Math.max(0, balanceAfter), // Ensure balance never goes negative
        totalDeposited: wallet.totalDeposited + amount,
      },
    });

    // Create transaction record
    await client.walletTransaction.create({
      data: {
        walletType: 'ADMIN_WALLET',
        adminWalletId: wallet.id,
        orderId,
        amount,
        type: 'COMMISSION',
        description: description || `Commission from order ${orderId.substring(0, 8).toUpperCase()}`,
        balanceBefore,
        balanceAfter,
        status: 'COMPLETED',
      },
    });

    return updatedWallet;
  },

  /**
   * Debit admin wallet (when paying out to agent)
   */
  async debitAdminWallet(amount: number, payoutId: string, description?: string, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    const wallet = await walletService.getAdminWallet(client);

    // Validate amount is positive
    if (amount <= 0) {
      throw new Error(`Invalid debit amount: ${amount}. Amount must be greater than 0.`);
    }

    if (wallet.balance < amount) {
      throw new Error(`Insufficient balance in admin wallet. Current: ${wallet.balance}, Required: ${amount}`);
    }

    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore - amount;

    // Ensure balance doesn't go negative (safety check)
    if (balanceAfter < 0) {
      throw new Error(`Debit would result in negative balance. Current: ${balanceBefore}, Debit: ${amount}`);
    }

    // Update wallet - use transaction client if provided
    const updatedWallet = await client.adminWallet.update({
      where: { id: wallet.id },
      data: {
        balance: balanceAfter,
        totalPaidOut: wallet.totalPaidOut + amount,
      },
    });

    // Create transaction record
    await client.walletTransaction.create({
      data: {
        walletType: 'ADMIN_WALLET',
        adminWalletId: wallet.id,
        amount: -amount, // Negative for debit
        type: 'PAYOUT',
        description: description || `Payout ${payoutId.substring(0, 8).toUpperCase()}`,
        balanceBefore,
        balanceAfter,
        status: 'COMPLETED',
      },
    });

    return updatedWallet;
  },

  /**
   * Debit agent wallet (when payout is processed)
   */
  async debitAgentWallet(agentId: string, amount: number, payoutId: string, description?: string, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    const wallet = await walletService.getAgentWallet(agentId, client);

    // Validate amount is positive
    if (amount <= 0) {
      throw new Error(`Invalid debit amount: ${amount}. Amount must be greater than 0.`);
    }

    if (wallet.balance < amount) {
      throw new Error(`Insufficient balance in agent wallet. Current: ${wallet.balance}, Required: ${amount}`);
    }

    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore - amount;

    // Ensure balance doesn't go negative (safety check)
    if (balanceAfter < 0) {
      throw new Error(`Debit would result in negative balance. Current: ${balanceBefore}, Debit: ${amount}`);
    }

    // Calculate next Monday for next payout
    const nextMonday = getNextMonday();

    // Update wallet - use transaction client if provided
    const updatedWallet = await client.agentWallet.update({
      where: { agentId },
      data: {
        balance: balanceAfter,
        totalPaidOut: wallet.totalPaidOut + amount,
        lastPayoutDate: new Date(),
        nextPayoutDate: nextMonday,
      },
    });

    // Create transaction record
    await client.walletTransaction.create({
      data: {
        walletType: 'AGENT_WALLET',
        agentWalletId: wallet.id,
        amount: -amount, // Negative for debit
        type: 'PAYOUT',
        description: description || `Payout ${payoutId.substring(0, 8).toUpperCase()}`,
        balanceBefore,
        balanceAfter,
        status: 'COMPLETED',
      },
    });

    return updatedWallet;
  },

  /**
   * Get agent wallet balance
   */
  async getAgentWalletBalance(agentId: string): Promise<WalletBalance> {
    const wallet = await walletService.getAgentWallet(agentId);
    return {
      balance: wallet.balance,
      totalEarned: wallet.totalEarned,
      totalPaidOut: wallet.totalPaidOut,
    };
  },

  /**
   * Get admin wallet balance
   */
  async getAdminWalletBalance(): Promise<WalletBalance & { totalDeposited: number }> {
    const wallet = await walletService.getAdminWallet();
    return {
      balance: wallet.balance,
      totalEarned: wallet.totalDeposited,
      totalPaidOut: wallet.totalPaidOut,
      totalDeposited: wallet.totalDeposited,
    };
  },

  /**
   * Reverse agent wallet credit (for cancelled delivered orders)
   */
  async reverseAgentWalletCredit(agentId: string, orderId: string, description?: string, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    
    // Find the original earning transaction
    const originalTransaction = await client.walletTransaction.findFirst({
      where: {
        orderId,
        walletType: 'AGENT_WALLET',
        type: 'EARNING',
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!originalTransaction) {
      // No transaction to reverse
      return null;
    }

    // Check if already reversed
    const existingReversal = await client.walletTransaction.findFirst({
      where: {
        orderId,
        walletType: 'AGENT_WALLET',
        type: 'REVERSAL',
        status: 'COMPLETED',
      },
    });

    if (existingReversal) {
      // Already reversed
      return await walletService.getAgentWallet(agentId, client);
    }

    const wallet = await walletService.getAgentWallet(agentId, client);
    const reversalAmount = originalTransaction.amount;
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore - reversalAmount;

    if (balanceAfter < 0) {
      throw new Error(`Cannot reverse: would result in negative balance. Current: ${balanceBefore}, Reversal: ${reversalAmount}`);
    }

    // Update wallet
    const updatedWallet = await client.agentWallet.update({
      where: { agentId },
      data: {
        balance: balanceAfter,
        totalEarned: Math.max(0, wallet.totalEarned - reversalAmount),
      },
    });

    // Create reversal transaction record
    await client.walletTransaction.create({
      data: {
        walletType: 'AGENT_WALLET',
        agentWalletId: wallet.id,
        orderId,
        amount: -reversalAmount, // Negative for reversal
        type: 'REVERSAL',
        description: description || `Reversal for cancelled order ${orderId.substring(0, 8).toUpperCase()}`,
        balanceBefore,
        balanceAfter,
        status: 'COMPLETED',
      },
    });

    return updatedWallet;
  },

  /**
   * Reverse admin wallet credit (for cancelled delivered orders)
   */
  async reverseAdminWalletCredit(orderId: string, description?: string, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    
    // Find the original commission transaction
    const originalTransaction = await client.walletTransaction.findFirst({
      where: {
        orderId,
        walletType: 'ADMIN_WALLET',
        type: 'COMMISSION',
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!originalTransaction) {
      // No transaction to reverse
      return null;
    }

    // Check if already reversed
    const existingReversal = await client.walletTransaction.findFirst({
      where: {
        orderId,
        walletType: 'ADMIN_WALLET',
        type: 'REVERSAL',
        status: 'COMPLETED',
      },
    });

    if (existingReversal) {
      // Already reversed
      return await walletService.getAdminWallet(client);
    }

    const wallet = await walletService.getAdminWallet(client);
    const reversalAmount = originalTransaction.amount;
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore - reversalAmount;

    if (balanceAfter < 0) {
      throw new Error(`Cannot reverse: would result in negative balance. Current: ${balanceBefore}, Reversal: ${reversalAmount}`);
    }

    // Update wallet
    const updatedWallet = await client.adminWallet.update({
      where: { id: wallet.id },
      data: {
        balance: balanceAfter,
        totalDeposited: Math.max(0, wallet.totalDeposited - reversalAmount),
      },
    });

    // Create reversal transaction record
    await client.walletTransaction.create({
      data: {
        walletType: 'ADMIN_WALLET',
        adminWalletId: wallet.id,
        orderId,
        amount: -reversalAmount, // Negative for reversal
        type: 'REVERSAL',
        description: description || `Reversal for cancelled order ${orderId.substring(0, 8).toUpperCase()}`,
        balanceBefore,
        balanceAfter,
        status: 'COMPLETED',
      },
    });

    return updatedWallet;
  },

  /**
   * Get wallet transactions
   */
  async getWalletTransactions(
    walletType: 'ADMIN_WALLET' | 'AGENT_WALLET',
    walletId?: string,
    limit: number = 50,
    offset: number = 0
  ) {
    try {
      const where: any = { walletType };
      if (walletType === 'ADMIN_WALLET' && walletId) {
        where.adminWalletId = walletId;
      } else if (walletType === 'AGENT_WALLET' && walletId) {
        where.agentWalletId = walletId;
      }

      const transactions = await prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          walletType: true,
          amount: true,
          type: true,
          description: true,
          balanceBefore: true,
          balanceAfter: true,
          status: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      const total = await prisma.walletTransaction.count({ where });

      return { transactions, total };
    } catch (error: any) {
      // If table doesn't exist, return empty results
      if (error?.code === 'P2021' || error?.code === '42P01' || error?.message?.includes('does not exist')) {
        console.warn('⚠️  WalletTransaction table does not exist - returning empty results');
        return { transactions: [], total: 0 };
      }
      throw error;
    }
  },
};

/**
 * Get next Monday date (for weekly payouts)
 */
function getNextMonday(): Date {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday;
}

/**
 * Get next month start date (1st of next month, for monthly payouts)
 */
function getNextMonthStart(): Date {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  nextMonth.setHours(0, 0, 0, 0);
  return nextMonth;
}

/**
 * Get next payout date based on payout plan
 */
function getNextPayoutDate(payoutPlan: 'WEEKLY' | 'MONTHLY'): Date {
  return payoutPlan === 'MONTHLY' ? getNextMonthStart() : getNextMonday();
}



