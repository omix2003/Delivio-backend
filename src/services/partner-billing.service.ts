import { prisma } from '../lib/prisma';
import { OrderStatus, PartnerCategory, BillingMode, BillingCycle } from '@prisma/client';
import { logger } from '../lib/logger';

/**
 * Partner Billing Service - Handles partner-type-aware billing
 * 
 * BILLING BEHAVIOR BY PARTNER TYPE:
 * - ECOMMERCE: Postpaid invoice, weekly/monthly, Net-7/15/30
 * - QUICK_COMMERCE: Postpaid invoice, daily/weekly, credit limit enforced
 * - LOCAL_STORE: Wallet-based, immediate deduction, optional weekly invoice
 * - ENTERPRISE: Monthly invoice, contract-based pricing
 * - RURAL_PARTNER: Route-based billing, weekly invoice
 */

export interface BillingConfig {
  partnerId: string;
  partnerType: PartnerCategory;
  billingMode: BillingMode;
  billingCycle: BillingCycle;
  creditPeriodDays: number;
  creditLimit?: number;
  minWalletBalance?: number;
}

export const partnerBillingService = {
  /**
   * Update billing config for a partner
   * Partners can update their billing cycle and other settings
   */
  async updateBillingConfig(
    partnerId: string,
    updates: {
      billingCycle?: BillingCycle;
      creditPeriodDays?: number;
      creditLimit?: number;
      minWalletBalance?: number;
    }
  ): Promise<BillingConfig> {
    // Get existing config
    const config = await this.getOrCreateBillingConfig(partnerId);

    // Validate billing cycle if provided
    if (updates.billingCycle) {
      const validCycles = ['DAILY', 'WEEKLY', 'MONTHLY'];
      if (!validCycles.includes(updates.billingCycle)) {
        throw new Error(`Invalid billing cycle. Must be one of: ${validCycles.join(', ')}`);
      }
    }

    // Validate credit period days
    if (updates.creditPeriodDays !== undefined) {
      if (updates.creditPeriodDays < 0 || updates.creditPeriodDays > 90) {
        throw new Error('Credit period days must be between 0 and 90');
      }
    }

    // Update config
    const updated = await prisma.partnerBillingConfig.update({
      where: { partnerId },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });

    logger.info(`Updated billing config for partner ${partnerId}`, updates);
    return updated as BillingConfig;
  },

  /**
   * Get or create billing config for a partner
   * Sets defaults based on partner type
   */
  async getOrCreateBillingConfig(partnerId: string): Promise<BillingConfig> {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { category: true },
    });

    if (!partner) {
      throw new Error('Partner not found');
    }

    let config = await prisma.partnerBillingConfig.findUnique({
      where: { partnerId },
    });

    if (!config) {
      // Create default config based on partner type
      const defaults = this.getDefaultBillingConfig(partner.category);
      
      config = await prisma.partnerBillingConfig.create({
        data: {
          partnerId,
          partnerType: partner.category,
          ...defaults,
        },
      });
    }

    return config as BillingConfig;
  },

  /**
   * Get default billing config based on partner type
   */
  getDefaultBillingConfig(partnerType: PartnerCategory): {
    billingMode: BillingMode;
    billingCycle: BillingCycle;
    creditPeriodDays: number;
    creditLimit?: number;
    minWalletBalance?: number;
  } {
    switch (partnerType) {
      case PartnerCategory.ECOMMERCE:
        return {
          billingMode: BillingMode.INVOICE,
          billingCycle: BillingCycle.WEEKLY,
          creditPeriodDays: 7, // Net-7
        };

      case PartnerCategory.QUICK_COMMERCE:
        return {
          billingMode: BillingMode.INVOICE,
          billingCycle: BillingCycle.DAILY,
          creditPeriodDays: 0, // Net-0 or Net-3
          creditLimit: 50000, // Default credit limit
        };

      case PartnerCategory.LOCAL_STORE:
        return {
          billingMode: BillingMode.WALLET,
          billingCycle: BillingCycle.WEEKLY,
          creditPeriodDays: 0,
          minWalletBalance: 100, // Minimum balance required
        };

      case PartnerCategory.ENTERPRISE:
        return {
          billingMode: BillingMode.CONTRACT,
          billingCycle: BillingCycle.MONTHLY,
          creditPeriodDays: 30, // Net-30
        };

      case PartnerCategory.RURAL_PARTNER:
        return {
          billingMode: BillingMode.INVOICE,
          billingCycle: BillingCycle.WEEKLY,
          creditPeriodDays: 7,
        };

      default:
        // Default to ECOMMERCE behavior
        return {
          billingMode: BillingMode.INVOICE,
          billingCycle: BillingCycle.WEEKLY,
          creditPeriodDays: 7,
        };
    }
  },

  /**
   * Decide billing behavior based on partner type
   * This is the core branching logic
   */
  async decideBillingBehavior(partnerId: string): Promise<{
    mode: BillingMode;
    shouldInvoice: boolean;
    shouldDeductWallet: boolean;
    shouldCheckCreditLimit: boolean;
  }> {
    const config = await this.getOrCreateBillingConfig(partnerId);

    switch (config.partnerType) {
      case PartnerCategory.ECOMMERCE:
      case PartnerCategory.QUICK_COMMERCE:
      case PartnerCategory.ENTERPRISE:
      case PartnerCategory.RURAL_PARTNER:
        return {
          mode: BillingMode.INVOICE,
          shouldInvoice: true,
          shouldDeductWallet: false,
          shouldCheckCreditLimit: config.partnerType === PartnerCategory.QUICK_COMMERCE,
        };

      case PartnerCategory.LOCAL_STORE:
        return {
          mode: BillingMode.WALLET,
          shouldInvoice: false, // Optional weekly invoice
          shouldDeductWallet: true,
          shouldCheckCreditLimit: false,
        };

      default:
        // Default to invoice
        return {
          mode: BillingMode.INVOICE,
          shouldInvoice: true,
          shouldDeductWallet: false,
          shouldCheckCreditLimit: false,
        };
    }
  },

  /**
   * Generate invoice for a partner based on billing cycle
   * Called by scheduled job
   */
  async generateInvoiceForPartner(partnerId: string): Promise<any> {
    const config = await this.getOrCreateBillingConfig(partnerId);
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { category: true, companyName: true },
    });

    if (!partner) {
      throw new Error('Partner not found');
    }

    // Calculate billing period based on cycle
    const { periodStart, periodEnd } = this.calculateBillingPeriod(config.billingCycle);

    // Check if invoice already exists for this period
    const existingInvoice = await prisma.partnerInvoice.findFirst({
      where: {
        partnerId,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
      },
    });

    if (existingInvoice) {
      logger.info(`Invoice already exists for partner ${partnerId} for period ${periodStart} to ${periodEnd}`);
      return existingInvoice;
    }

    // Fetch delivered orders not yet billed
    const orders = await this.getUnbilledOrders(partnerId, periodStart, periodEnd);

    if (orders.length === 0) {
      logger.info(`No unbilled orders found for partner ${partnerId} in period ${periodStart} to ${periodEnd}`);
      return null;
    }

    // Calculate total amount (use order.partnerCharge - DO NOT recalculate)
    const totalAmount = orders.reduce((sum, order) => {
      let charge = order.partnerCharge || 0;
      // Add RTO charge if applicable
      if (order.isRTO && order.rtoCharge) {
        charge += order.rtoCharge;
      }
      return sum + charge;
    }, 0);

    // Check credit limit for QUICK_COMMERCE
    if (config.partnerType === PartnerCategory.QUICK_COMMERCE && config.creditLimit) {
      // Get pending invoice total
      const pendingInvoices = await prisma.partnerInvoice.aggregate({
        where: {
          partnerId,
          status: {
            in: ['DRAFT', 'SENT', 'ACKNOWLEDGED'],
          },
        },
        _sum: {
          totalAmount: true,
        },
      });

      const pendingTotal = pendingInvoices._sum.totalAmount || 0;
      if (pendingTotal + totalAmount > config.creditLimit) {
        throw new Error(
          `Credit limit exceeded. Pending: ${pendingTotal}, New: ${totalAmount}, Limit: ${config.creditLimit}`
        );
      }
    }

    // Generate invoice number
    const invoiceNumber = await this.generateInvoiceNumber(partner.companyName, 'INV');

    // Calculate due date
    const dueDate = this.calculateDueDate(periodEnd, config.creditPeriodDays);

    // Determine payment terms
    const paymentTerms = this.getPaymentTerms(config.creditPeriodDays);

    // Create invoice (Prisma will auto-generate IDs using cuid)
    const invoice = await prisma.partnerInvoice.create({
      data: {
        invoiceNumber,
        partnerId,
        partnerType: partner.category,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        totalAmount,
        paymentTerms,
        dueDate,
        status: 'DRAFT',
        items: {
          create: orders.map((order) => ({
            orderId: order.id,
            orderNumber: order.id.substring(0, 12).toUpperCase(),
            route: this.formatRoute(order),
            serviceType: this.getServiceType(order),
            amount: (order.partnerCharge || 0) + (order.isRTO && order.rtoCharge ? order.rtoCharge : 0),
          })),
        },
      },
      include: {
        items: true,
        partner: {
          select: {
            companyName: true,
            billingEmail: true,
          },
        },
      },
    });

    logger.info(`Generated invoice ${invoiceNumber} for partner ${partnerId} with ${orders.length} orders`);
    return invoice;
  },

  /**
   * Calculate billing period based on cycle
   */
  calculateBillingPeriod(cycle: BillingCycle): { periodStart: Date; periodEnd: Date } {
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    switch (cycle) {
      case BillingCycle.DAILY:
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;

      case BillingCycle.WEEKLY:
        // Week starts on Monday
        const dayOfWeek = now.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
        periodStart.setHours(0, 0, 0, 0);
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + 6);
        periodEnd.setHours(23, 59, 59, 999);
        break;

      case BillingCycle.MONTHLY:
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        break;

      default:
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    }

    return { periodStart, periodEnd };
  },

  /**
   * Get unbilled delivered orders for a period
   */
  async getUnbilledOrders(partnerId: string, periodStart: Date, periodEnd: Date) {
    // Get all delivered orders in period
    const allOrders = await prisma.order.findMany({
      where: {
        partnerId,
        status: OrderStatus.DELIVERED,
        deliveredAt: {
          gte: periodStart,
          lte: periodEnd,
        },
        partnerCharge: {
          not: null,
        },
      },
      include: {
        originWarehouse: true,
        currentWarehouse: true,
      },
      orderBy: {
        deliveredAt: 'asc',
      },
    });

    // Get order IDs already in invoices
    const billedOrderIds = await prisma.partnerInvoiceItem.findMany({
      where: {
        invoice: {
          partnerId,
        },
      },
      select: {
        orderId: true,
      },
    });

    const billedIds = new Set(billedOrderIds.map((item) => item.orderId));

    // Filter out already billed orders
    return allOrders.filter((order) => !billedIds.has(order.id));
  },

  /**
   * Format route for invoice display
   */
  formatRoute(order: any): string {
    if (order.originWarehouse && order.currentWarehouse) {
      const originCity = order.originWarehouse.city || order.originWarehouse.name.substring(0, 3).toUpperCase();
      const destCity = order.currentWarehouse.city || order.currentWarehouse.name.substring(0, 3).toUpperCase();
      return `${originCity} → ${destCity}`;
    }
    return 'Multi-leg Delivery';
  },

  /**
   * Get service type for invoice item
   */
  getServiceType(order: any): string {
    if (order.isRTO) {
      return 'RTO (Return to Origin)';
    }
    
    // Check if multi-leg (has logistics provider)
    if (order.logisticsProviderId) {
      return 'Multi-leg E-commerce';
    }
    
    return 'Single-leg Delivery';
  },

  /**
   * Generate invoice number
   */
  async generateInvoiceNumber(partnerName: string, type: string): Promise<string> {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const partnerCode = partnerName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'PAR';
    
    const lastInvoice = await prisma.partnerInvoice.findFirst({
      where: {
        invoiceNumber: {
          startsWith: `${type}-${partnerCode}-${year}${month}`,
        },
      },
      orderBy: {
        invoiceNumber: 'desc',
      },
    });

    let sequence = 1;
    if (lastInvoice) {
      const lastSeq = parseInt(lastInvoice.invoiceNumber.split('-').pop() || '0');
      sequence = lastSeq + 1;
    }

    return `${type}-${partnerCode}-${year}${month}-${String(sequence).padStart(4, '0')}`;
  },

  /**
   * Calculate due date
   */
  calculateDueDate(endDate: Date, creditPeriodDays: number): Date {
    const dueDate = new Date(endDate);
    dueDate.setDate(dueDate.getDate() + creditPeriodDays);
    return dueDate;
  },

  /**
   * Get payment terms string
   */
  getPaymentTerms(creditPeriodDays: number): string {
    if (creditPeriodDays === 0) return 'NET_0';
    if (creditPeriodDays === 3) return 'NET_3';
    if (creditPeriodDays === 7) return 'NET_7';
    if (creditPeriodDays === 15) return 'NET_15';
    if (creditPeriodDays === 30) return 'NET_30';
    return `NET_${creditPeriodDays}`;
  },

  /**
   * Process invoice generation for all partners
   * Called by scheduled job
   */
  async processInvoiceGeneration(): Promise<{
    processed: number;
    generated: number;
    errors: Array<{ partnerId: string; error: string }>;
  }> {
    const partners = await prisma.partner.findMany({
      where: {
        isActive: true,
        category: {
          in: [
            PartnerCategory.ECOMMERCE,
            PartnerCategory.QUICK_COMMERCE,
            PartnerCategory.ENTERPRISE,
            PartnerCategory.RURAL_PARTNER,
          ],
        },
      },
      select: { id: true },
    });

    const results = {
      processed: partners.length,
      generated: 0,
      errors: [] as Array<{ partnerId: string; error: string }>,
    };

    for (const partner of partners) {
      try {
        const config = await this.getOrCreateBillingConfig(partner.id);
        
        // Check if it's time to generate invoice based on billing cycle
        if (await this.shouldGenerateInvoice(partner.id, config.billingCycle)) {
          const invoice = await this.generateInvoiceForPartner(partner.id);
          if (invoice) {
            results.generated++;
          }
        }
      } catch (error: any) {
        logger.error(`Error generating invoice for partner ${partner.id}:`, error);
        results.errors.push({
          partnerId: partner.id,
          error: error.message || 'Unknown error',
        });
      }
    }

    return results;
  },

  /**
   * Check if invoice should be generated based on billing cycle
   */
  async shouldGenerateInvoice(partnerId: string, cycle: BillingCycle): Promise<boolean> {
    const { periodEnd } = this.calculateBillingPeriod(cycle);
    const now = new Date();

    // For daily, generate at end of day
    if (cycle === BillingCycle.DAILY) {
      return now >= periodEnd;
    }

    // For weekly, generate on last day of week (Sunday)
    if (cycle === BillingCycle.WEEKLY) {
      return now.getDay() === 0; // Sunday
    }

    // For monthly, generate on last day of month
    if (cycle === BillingCycle.MONTHLY) {
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return now.getDate() === lastDayOfMonth.getDate();
    }

    return false;
  },
};

