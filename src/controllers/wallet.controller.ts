import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { walletService } from '../services/wallet.service';
import { payoutService } from '../services/payout.service';
import { getAgentId } from '../utils/role.util';
import { AppError } from '../utils/errors.util';

export const walletController = {
  /**
   * GET /api/agent/wallet
   * Get agent wallet balance
   */
  async getAgentWallet(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        throw new AppError('Agent ID not found', 401);
      }

      const balance = await walletService.getAgentWalletBalance(agentId);
      const wallet = await walletService.getAgentWallet(agentId);

      res.json({
        ...balance,
        lastPayoutDate: wallet.lastPayoutDate,
        nextPayoutDate: wallet.nextPayoutDate,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/agent/wallet/transactions
   * Get agent wallet transactions
   */
  async getAgentWalletTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        throw new AppError('Agent ID not found', 401);
      }

      const wallet = await walletService.getAgentWallet(agentId);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      const { transactions, total } = await walletService.getWalletTransactions(
        'AGENT_WALLET',
        wallet.id,
        limit,
        offset
      );

      res.json({
        transactions,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/admin/wallet
   * Get admin wallet balance
   */
  async getAdminWallet(req: Request, res: Response, next: NextFunction) {
    try {
      const balance = await walletService.getAdminWalletBalance();
      res.json(balance);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/admin/wallet/transactions
   * Get admin wallet transactions
   */
  async getAdminWalletTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const wallet = await walletService.getAdminWallet();
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      const { transactions, total } = await walletService.getWalletTransactions(
        'ADMIN_WALLET',
        wallet.id,
        limit,
        offset
      );

      res.json({
        transactions,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/agent/payouts
   * Get agent payout history
   */
  async getAgentPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        throw new AppError('Agent ID not found', 401);
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      const { payouts, total } = await payoutService.getAgentPayoutHistory(agentId, limit, offset);

      res.json({
        payouts,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/admin/payouts
   * Get all payouts (admin view)
   */
  async getAllPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as string | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      const { payouts, total } = await payoutService.getAllPayouts(status, limit, offset);

      res.json({
        payouts,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/admin/payouts/ready
   * Get agents ready for payout (grouped by plan)
   */
  async getAgentsReadyForPayout(req: Request, res: Response, next: NextFunction) {
    try {
      const { weekly, monthly } = await payoutService.getAgentsReadyForPayout();
      res.json({ 
        weekly: weekly.map(a => ({ agentId: a.agentId, balance: a.balance, nextPayoutDate: a.nextPayoutDate, agentName: a.agentName })),
        monthly: monthly.map(a => ({ agentId: a.agentId, balance: a.balance, nextPayoutDate: a.nextPayoutDate, agentName: a.agentName })),
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/admin/payouts/process
   * Process payout for an agent (automatically uses agent's payout plan)
   */
  async processPayout(req: Request, res: Response, next: NextFunction) {
    try {
      const { agentId, paymentMethod, bankAccount, upiId, weekStart, monthStart } = req.body;

      console.log('[Wallet Controller] Processing payout request:', {
        agentId,
        paymentMethod,
        hasBankAccount: !!bankAccount,
        hasUpiId: !!upiId,
        weekStart,
        monthStart,
      });

      if (!agentId || !paymentMethod) {
        throw new AppError('Agent ID and payment method are required', 400);
      }

      // Get agent to check payout plan
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { payoutPlan: true },
      });

      if (!agent) {
        throw new AppError('Agent not found', 404);
      }

      console.log('[Wallet Controller] Agent payout plan:', agent.payoutPlan);

      let payout;
      try {
        if (agent.payoutPlan === 'MONTHLY') {
          console.log('[Wallet Controller] Processing monthly payout...');
          payout = await payoutService.processMonthlyPayout(
            agentId,
            paymentMethod,
            bankAccount,
            upiId,
            monthStart ? new Date(monthStart) : undefined
          );
        } else {
          console.log('[Wallet Controller] Processing weekly payout...');
          payout = await payoutService.processWeeklyPayout(
            agentId,
            paymentMethod,
            bankAccount,
            upiId,
            weekStart ? new Date(weekStart) : undefined
          );
        }
        console.log('[Wallet Controller] Payout processed successfully:', {
          payoutId: payout.id,
          status: payout.status,
          transactionId: payout.transactionId,
        });
      } catch (payoutError: any) {
        console.error('[Wallet Controller] Error in payout service:', {
          message: payoutError?.message,
          stack: payoutError?.stack,
          code: payoutError?.code,
          name: payoutError?.name,
        });
        throw payoutError; // Re-throw to be caught by outer catch
      }
      
      res.json({
        message: 'Payout processed successfully',
        payout,
        gatewayInfo: {
          transactionId: payout.transactionId,
          status: payout.status,
          paymentMethod: payout.paymentMethod,
          note: payout.status === 'PENDING' 
            ? 'Payout is queued with payment gateway. Check backend logs for details.'
            : payout.status === 'PROCESSED'
            ? 'Payout processed successfully via payment gateway.'
            : 'Payout status: ' + payout.status,
        },
      });
    } catch (error: any) {
      console.error('[Wallet Controller] Error processing payout:', error);
      console.error('[Wallet Controller] Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        meta: error?.meta,
        requestBody: req.body,
        isAppError: error instanceof AppError,
        statusCode: error instanceof AppError ? error.statusCode : undefined,
      });
      
      // Import PayoutError to check for payout-specific errors
      const { PayoutError } = await import('../utils/payout-errors.util');
      
      // If it's a known error (AppError or PayoutError), pass it through
      if (error instanceof AppError || error instanceof PayoutError) {
        console.error('[Wallet Controller] Passing known error to error handler:', {
          name: error.name,
          message: error.message,
          statusCode: error.statusCode || (error as any).statusCode,
        });
        return next(error);
      }
      
      // For unknown errors, wrap them in AppError with 500 status
      const appError = new AppError(
        error?.message || 'Failed to process payout',
        500
      );
      console.error('[Wallet Controller] Wrapping error in AppError:', {
        name: appError.name,
        message: appError.message,
        statusCode: appError.statusCode,
      });
      next(appError);
    }
  },

  /**
   * POST /api/admin/payouts/process-all-weekly
   * Process weekly payouts for all eligible agents
   */
  async processAllWeeklyPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const { paymentMethod = 'BANK_TRANSFER' } = req.body;

      const result = await payoutService.processAllWeeklyPayouts(paymentMethod);

      res.json({
        message: 'Weekly payout processing completed',
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/admin/payouts/process-all-monthly
   * Process monthly payouts for all eligible agents
   */
  async processAllMonthlyPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const { paymentMethod = 'BANK_TRANSFER' } = req.body;

      const result = await payoutService.processAllMonthlyPayouts(paymentMethod);

      res.json({
        message: 'Monthly payout processing completed',
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },
};



