import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { getPartnerId } from '../utils/role.util';
import { billingService } from '../services/billing.service';
import { partnerBillingService } from '../services/partner-billing.service';
import { partnerWalletService } from '../services/partner-wallet.service';

/**
 * Billing Controller - Handles invoice generation and settlement
 */
export const billingController = {
  /**
   * POST /api/admin/billing/partner-invoices/generate
   * Generate partner invoice for a billing period
   */
  async generatePartnerInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const { partnerId, periodStart, periodEnd, paymentTerms } = req.body;

      if (!partnerId || !periodStart || !periodEnd) {
        return res.status(400).json({
          error: 'partnerId, periodStart, and periodEnd are required',
        });
      }

      const invoice = await billingService.generatePartnerInvoice(
        partnerId,
        new Date(periodStart),
        new Date(periodEnd),
        paymentTerms || 'NET_7'
      );

      res.json({
        message: 'Partner invoice generated successfully',
        invoice,
      });
    } catch (error: any) {
      if (error.message === 'No delivered orders found for this period') {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * GET /api/partner/invoices
   * Get partner's invoices
   */
  async getPartnerInvoices(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { status, limit = 50, offset = 0 } = req.query;

      const where: any = { partnerId };
      if (status) {
        where.status = status;
      }

      const invoices = await prisma.partnerInvoice.findMany({
        where,
        include: {
          items: {
            include: {
              order: {
                select: {
                  id: true,
                  deliveredAt: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      });

      res.json({
        invoices,
        total: invoices.length,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/partner/invoices/:id
   * Get partner invoice details
   */
  async getPartnerInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { id } = req.params;

      const invoice = await prisma.partnerInvoice.findFirst({
        where: {
          id,
          partnerId, // Ensure partner owns this invoice
        },
        include: {
          items: {
            include: {
              order: {
                select: {
                  id: true,
                  deliveredAt: true,
                  customerName: true,
                  customerAddress: true,
                },
              },
            },
          },
          partner: {
            select: {
              companyName: true,
              billingEmail: true,
              address: true,
            },
          },
        },
      });

      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      res.json(invoice);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/partner/invoices/:id/acknowledge
   * Partner acknowledges invoice
   */
  async acknowledgeInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { id } = req.params;

      const invoice = await prisma.partnerInvoice.findFirst({
        where: {
          id,
          partnerId,
        },
      });

      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      if (invoice.status !== 'SENT') {
        return res.status(400).json({ error: 'Invoice must be in SENT status to acknowledge' });
      }

      const updated = await prisma.partnerInvoice.update({
        where: { id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: new Date(),
        },
      });

      res.json({
        message: 'Invoice acknowledged successfully',
        invoice: updated,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/partner/invoices/:id/dispute
   * Partner disputes invoice
   */
  async disputeInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { id } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: 'Dispute reason is required' });
      }

      const invoice = await prisma.partnerInvoice.findFirst({
        where: {
          id,
          partnerId,
        },
      });

      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      if (invoice.status === 'PAID') {
        return res.status(400).json({ error: 'Cannot dispute a paid invoice' });
      }

      // Get existing metadata and merge with dispute info
      const existingMetadata = (invoice.metadata as any) || {};
      const updated = await prisma.partnerInvoice.update({
        where: { id },
        data: {
          status: 'DISPUTED',
          metadata: {
            ...existingMetadata,
            disputeReason: reason,
            disputedAt: new Date().toISOString(),
          } as any,
        },
      });

      res.json({
        message: 'Invoice disputed successfully',
        invoice: updated,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/partner/billing/config
   * Get partner billing configuration
   */
  async getBillingConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const config = await partnerBillingService.getOrCreateBillingConfig(partnerId);

      res.json(config);
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/partner/billing/config
   * Update partner billing configuration
   */
  async updateBillingConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { billingCycle, creditPeriodDays, creditLimit, minWalletBalance } = req.body;

      console.log('[Billing Controller] Update request:', { billingCycle, creditPeriodDays, creditLimit, minWalletBalance });

      // Validate at least one field is provided
      if (!billingCycle && creditPeriodDays === undefined && creditLimit === undefined && minWalletBalance === undefined) {
        return res.status(400).json({ error: 'At least one field must be provided for update' });
      }

      const updates: any = {};
      if (billingCycle) {
        // Validate billing cycle
        const validCycles = ['DAILY', 'WEEKLY', 'MONTHLY'];
        if (!validCycles.includes(billingCycle)) {
          return res.status(400).json({ error: `Invalid billing cycle. Must be one of: ${validCycles.join(', ')}` });
        }
        updates.billingCycle = billingCycle;
      }
      if (creditPeriodDays !== undefined) {
        if (creditPeriodDays < 0 || creditPeriodDays > 90) {
          return res.status(400).json({ error: 'Credit period days must be between 0 and 90' });
        }
        updates.creditPeriodDays = creditPeriodDays;
      }
      // Handle creditLimit: allow null to clear, or a number
      if (creditLimit !== undefined) {
        updates.creditLimit = creditLimit === null || creditLimit === '' ? null : Number(creditLimit);
      }
      // Handle minWalletBalance: allow null to clear, or a number
      if (minWalletBalance !== undefined) {
        updates.minWalletBalance = minWalletBalance === null || minWalletBalance === '' ? null : Number(minWalletBalance);
      }

      console.log('[Billing Controller] Updates to apply:', updates);

      const config = await partnerBillingService.updateBillingConfig(partnerId, updates);

      res.json({
        message: 'Billing configuration updated successfully',
        config,
      });
    } catch (error: any) {
      console.error('[Billing Controller] Error updating billing config:', error);
      if (error.message.includes('Invalid billing cycle') || error.message.includes('Credit period')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * POST /api/partner/wallet/topup
   * Top up partner wallet (for LOCAL_STORE)
   */
  async topUpWallet(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { amount, description } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid amount is required' });
      }

      const wallet = await partnerWalletService.topUp(partnerId, amount, description);

      res.json({
        message: 'Wallet topped up successfully',
        wallet,
      });
    } catch (error: any) {
      if (error.message.includes('must be positive')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * GET /api/partner/wallet/balance
   * Get partner wallet balance and transaction history
   */
  async getWalletBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(404).json({ error: 'Partner profile not found' });
      }

      const { limit } = req.query;
      const details = await partnerWalletService.getWalletDetails(
        partnerId,
        limit ? parseInt(limit as string) : 50
      );

      res.json(details);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/admin/billing/invoices/generate-all
   * Generate invoices for all partners (scheduled job)
   */
  async generateAllInvoices(req: Request, res: Response, next: NextFunction) {
    try {
      const results = await partnerBillingService.processInvoiceGeneration();

      res.json({
        message: 'Invoice generation completed',
        results,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/admin/billing/provider-settlements/generate
   * Generate provider settlement for a billing period
   */
  async generateProviderSettlement(req: Request, res: Response, next: NextFunction) {
    try {
      const { logisticsProviderId, periodStart, periodEnd } = req.body;

      if (!logisticsProviderId || !periodStart || !periodEnd) {
        return res.status(400).json({
          error: 'logisticsProviderId, periodStart, and periodEnd are required',
        });
      }

      const settlement = await billingService.generateProviderSettlement(
        logisticsProviderId,
        new Date(periodStart),
        new Date(periodEnd)
      );

      res.json({
        message: 'Provider settlement generated successfully',
        settlement,
      });
    } catch (error: any) {
      if (error.message === 'No Leg 2 orders found for this period') {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * GET /api/logistics-provider/settlements
   * Get logistics provider's settlements
   */
  async getProviderSettlements(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getPartnerId(req);
      if (!logisticsProviderId) {
        return res.status(404).json({ error: 'Logistics provider profile not found' });
      }

      const { status, limit = 50, offset = 0 } = req.query;

      const where: any = { logisticsProviderId };
      if (status) {
        where.status = status;
      }

      const settlements = await prisma.providerSettlement.findMany({
        where,
        include: {
          items: {
            include: {
              order: {
                select: {
                  id: true,
                  warehouseArrivedAt: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      });

      res.json({
        settlements,
        total: settlements.length,
      });
    } catch (error) {
      next(error);
    }
  },
};

