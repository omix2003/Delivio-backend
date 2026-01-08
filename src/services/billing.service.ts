import { prisma } from '../lib/prisma';
import { OrderStatus } from '@prisma/client';
import { generateId } from '../utils/id-generator.util';

/**
 * Billing Service - Handles invoicing for partners and settlements with providers
 * 
 * GOLDEN PRINCIPLE:
 * - Partners receive ONE consolidated invoice from platform
 * - Logistics providers invoice platform (not partners)
 * - Delivery agents are paid internally (not invoiced)
 */

export interface BillingCalculation {
  partnerCharge: number; // Final amount partner is invoiced
  providerCharge: number; // Amount provider charges for Leg 2
  leg1Cost: number; // Internal cost for Leg 1
  leg3Cost: number; // Internal cost for Leg 3
  platformMargin: number; // Platform margin
}

export const billingService = {
  /**
   * Calculate billing amounts for a multi-leg order
   * Called at order creation/completion
   */
  async calculateOrderBilling(orderId: string): Promise<BillingCalculation> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        partner: true,
        logisticsProvider: true,
        originWarehouse: true,
        currentWarehouse: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Get leg costs from order or calculate
    const leg1Cost = order.leg1Cost || 0; // Will be set when Leg 1 completes
    const leg3Cost = order.leg3Cost || 0; // Will be set when Leg 3 completes
    
    // Provider charge for Leg 2 (warehouse → warehouse)
    // This is typically negotiated rate or per-km rate
    // For now, we'll use a default calculation based on distance
    let providerCharge = order.providerCharge || 0;
    
    if (!providerCharge && order.logisticsProviderId && order.originWarehouseId && order.currentWarehouseId) {
      // Calculate provider charge based on warehouse distance
      const originWarehouse = order.originWarehouse;
      const currentWarehouse = order.currentWarehouse;
      
      if (originWarehouse && currentWarehouse) {
        // Default: ₹2 per km for Leg 2 (this should be configurable per provider)
        const distanceKm = this.calculateDistance(
          originWarehouse.latitude,
          originWarehouse.longitude,
          currentWarehouse.latitude,
          currentWarehouse.longitude
        );
        providerCharge = distanceKm * 2; // Default rate, should be from provider contract
      }
    }

    // Platform margin (typically 15-20% of total cost)
    const totalCost = leg1Cost + providerCharge + leg3Cost;
    const platformMargin = totalCost * 0.15; // 15% margin

    // Partner charge = total cost + platform margin
    const partnerCharge = totalCost + platformMargin;

    return {
      partnerCharge: Math.round(partnerCharge * 100) / 100,
      providerCharge: Math.round(providerCharge * 100) / 100,
      leg1Cost: Math.round(leg1Cost * 100) / 100,
      leg3Cost: Math.round(leg3Cost * 100) / 100,
      platformMargin: Math.round(platformMargin * 100) / 100,
    };
  },

  /**
   * Calculate distance between two points (Haversine formula)
   */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  },

  /**
   * Update order billing amounts when order is delivered
   */
  async updateOrderBilling(orderId: string): Promise<void> {
    const billing = await this.calculateOrderBilling(orderId);
    
    await prisma.order.update({
      where: { id: orderId },
      data: {
        partnerCharge: billing.partnerCharge,
        providerCharge: billing.providerCharge,
        leg1Cost: billing.leg1Cost,
        leg3Cost: billing.leg3Cost,
        platformMargin: billing.platformMargin,
      },
    });
  },

  /**
   * Generate partner invoice for a billing period
   * Includes only successfully delivered orders
   */
  async generatePartnerInvoice(
    partnerId: string,
    periodStart: Date,
    periodEnd: Date,
    paymentTerms: string = 'NET_7'
  ) {
    // Find all delivered orders in the period (including RTO orders)
    const orders = await prisma.order.findMany({
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

    if (orders.length === 0) {
      throw new Error('No delivered orders found for this period');
    }

    // Calculate total amount (including RTO charges if applicable)
    const totalAmount = orders.reduce((sum, order) => {
      let charge = order.partnerCharge || 0;
      // Add RTO charge if this is an RTO order
      if (order.isRTO && order.rtoCharge) {
        charge += order.rtoCharge;
      }
      return sum + charge;
    }, 0);

    // Generate invoice number
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { companyName: true, category: true },
    });

    if (!partner) {
      throw new Error('Partner not found');
    }

    const partnerCode = partner.companyName.substring(0, 3).toUpperCase() || 'PAR';
    const invoiceNumber = await this.generateInvoiceNumber(partnerCode, 'INV');

    // Calculate due date based on payment terms
    const dueDate = this.calculateDueDate(periodEnd, paymentTerms);

    // Create invoice (Prisma will auto-generate IDs using cuid)
    const invoice = await prisma.partnerInvoice.create({
      data: {
        invoiceNumber,
        partnerId,
        partnerType: partner.category || 'ECOMMERCE', // Required field
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
            serviceType: order.isRTO ? 'RTO (Return to Origin)' : 'Multi-leg E-commerce',
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

    return invoice;
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
   * Generate invoice number
   */
  async generateInvoiceNumber(prefix: string, type: string): Promise<string> {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Find last invoice with same prefix
    const lastInvoice = await prisma.partnerInvoice.findFirst({
      where: {
        invoiceNumber: {
          startsWith: `${type}-${prefix}-${year}${month}`,
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

    return `${type}-${prefix}-${year}${month}-${String(sequence).padStart(4, '0')}`;
  },

  /**
   * Calculate due date based on payment terms
   */
  calculateDueDate(endDate: Date, paymentTerms: string): Date {
    const days = paymentTerms === 'NET_7' ? 7 : paymentTerms === 'NET_15' ? 15 : 30;
    const dueDate = new Date(endDate);
    dueDate.setDate(dueDate.getDate() + days);
    return dueDate;
  },

  /**
   * Generate provider settlement for a billing period
   * Includes only Leg 2 orders (warehouse → warehouse)
   */
  async generateProviderSettlement(
    logisticsProviderId: string,
    periodStart: Date,
    periodEnd: Date
  ) {
    // Find all orders where Leg 2 was completed (arrived at destination warehouse)
    const orders = await prisma.order.findMany({
      where: {
        logisticsProviderId,
        status: {
          in: [OrderStatus.AT_WAREHOUSE, OrderStatus.READY_FOR_PICKUP, OrderStatus.DELIVERED],
        },
        warehouseArrivedAt: {
          gte: periodStart,
          lte: periodEnd,
        },
        providerCharge: {
          not: null,
        },
      },
      include: {
        originWarehouse: true,
        currentWarehouse: true,
      },
      orderBy: {
        warehouseArrivedAt: 'asc',
      },
    });

    if (orders.length === 0) {
      throw new Error('No Leg 2 orders found for this period');
    }

    // Calculate total amount (only Leg 2 charges)
    const totalAmount = orders.reduce((sum, order) => {
      return sum + (order.providerCharge || 0);
    }, 0);

    // Generate settlement number
    const provider = await prisma.logisticsProvider.findUnique({
      where: { id: logisticsProviderId },
      select: { companyName: true },
    });

    const providerCode = provider?.companyName.substring(0, 3).toUpperCase() || 'PROV';
    const settlementNumber = await this.generateSettlementNumber(providerCode);

    // Check for SLA breaches (delayLeg = MIDDLE_MILE)
    const itemsWithSlaBreach = orders.filter((order) => {
      const transitLegs = order.transitLegs as any;
      if (Array.isArray(transitLegs)) {
        const leg2 = transitLegs.find((leg: any) => leg.leg === 2);
        return leg2?.delayLeg === 'MIDDLE_MILE';
      }
      return false;
    });

    // Create settlement (Prisma will auto-generate IDs using cuid)
    const settlement = await prisma.providerSettlement.create({
      data: {
        settlementNumber,
        logisticsProviderId,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        totalAmount,
        status: 'PENDING',
        items: {
          create: orders.map((order) => {
            const transitLegs = order.transitLegs as any;
            const leg2 = Array.isArray(transitLegs) 
              ? transitLegs.find((leg: any) => leg.leg === 2) 
              : null;
            const hasSlaBreach = leg2?.delayLeg === 'MIDDLE_MILE';
            
            return {
              orderId: order.id,
              shipmentRef: order.transitTrackingNumber || order.id.substring(0, 12).toUpperCase(),
              originWarehouse: order.originWarehouse?.name || 'Unknown',
              destWarehouse: order.currentWarehouse?.name || 'Unknown',
              amount: order.providerCharge || 0,
              hasSlaBreach,
              adjustmentAmount: hasSlaBreach ? (order.providerCharge || 0) * -0.1 : null, // 10% penalty for SLA breach
            };
          }),
        },
      },
      include: {
        items: true,
        logisticsProvider: {
          select: {
            companyName: true,
            billingEmail: true,
          },
        },
      },
    });

    // Calculate total adjustments
    const totalAdjustments = settlement.items.reduce((sum, item) => {
      return sum + (item.adjustmentAmount || 0);
    }, 0);

    // Update settlement with adjustments if any
    if (totalAdjustments !== 0) {
      await prisma.providerSettlement.update({
        where: { id: settlement.id },
        data: {
          totalAmount: settlement.totalAmount + totalAdjustments,
          adjustments: {
            totalAdjustments,
            slaBreachCount: itemsWithSlaBreach.length,
            adjustmentReason: 'SLA breach penalties',
          } as any,
        },
      });
    }

    return settlement;
  },

  /**
   * Generate settlement number
   */
  async generateSettlementNumber(prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    const lastSettlement = await prisma.providerSettlement.findFirst({
      where: {
        settlementNumber: {
          startsWith: `SETTLE-${prefix}-${year}${month}`,
        },
      },
      orderBy: {
        settlementNumber: 'desc',
      },
    });

    let sequence = 1;
    if (lastSettlement) {
      const lastSeq = parseInt(lastSettlement.settlementNumber.split('-').pop() || '0');
      sequence = lastSeq + 1;
    }

    return `SETTLE-${prefix}-${year}${month}-${String(sequence).padStart(4, '0')}`;
  },
};

