import { prisma } from '../lib/prisma';
import { pricingService } from './pricing.service';
import { OrderStatus, PartnerCategory } from '@prisma/client';
import { generateId } from '../utils/id-generator.util';

/**
 * Service to handle automatic order creation for multi-leg logistics flow
 */
export const logisticsOrderService = {
  /**
   * Creates a delivery order from destination warehouse to final customer location
   * This is called automatically when an order reaches the destination warehouse
   */
  async createDeliveryOrderFromWarehouse(
    parentOrderId: string,
    destinationWarehouseId: string,
    finalDeliveryLat: number,
    finalDeliveryLng: number,
    finalDeliveryAddress: string,
    finalDeliveryWarehouseId?: string
  ) {
    // Get the parent order
    const parentOrder = await prisma.order.findUnique({
      where: { id: parentOrderId },
      include: {
        partner: true,
        logisticsProvider: true,
        currentWarehouse: true,
      },
    });

    if (!parentOrder) {
      throw new Error('Parent order not found');
    }

    // Get destination warehouse
    const destinationWarehouse = await prisma.warehouse.findUnique({
      where: { id: destinationWarehouseId },
      include: {
        partner: true,
      },
    });

    if (!destinationWarehouse) {
      throw new Error('Destination warehouse not found');
    }

    // Calculate pricing for the delivery leg (warehouse to customer)
    let pricing;
    try {
      pricing = await pricingService.calculateOrderPricing({
        partnerId: parentOrder.partnerId,
        pickupLat: destinationWarehouse.latitude,
        pickupLng: destinationWarehouse.longitude,
        dropLat: finalDeliveryLat,
        dropLng: finalDeliveryLng,
        isSurge: false,
      });
    } catch (error: any) {
      throw new Error(`Pricing calculation failed: ${error.message}`);
    }

    // Get SLA priority based on partner category
    const slaPriority = pricingService.getSLAPriority(parentOrder.partner?.category || PartnerCategory.LOCAL_STORE);

    // Generate order ID
    const orderId = await generateId('ORD');

    // Create the delivery order
    const deliveryOrder = await prisma.order.create({
      data: {
        id: orderId,
        partnerId: parentOrder.partnerId,
        // Pickup from destination warehouse
        pickupWarehouseId: destinationWarehouseId,
        pickupLat: destinationWarehouse.latitude,
        pickupLng: destinationWarehouse.longitude,
        pickupAddressText: `${destinationWarehouse.name}, ${destinationWarehouse.address}`,
        // Drop to final customer location
        dropLat: finalDeliveryLat,
        dropLng: finalDeliveryLng,
        dropAddressText: finalDeliveryAddress,
        dropWarehouseId: finalDeliveryWarehouseId || null,
        // Pricing
        payoutAmount: pricing.agentPayout,
        orderAmount: pricing.partnerPayment,
        partnerPayment: pricing.partnerPayment,
        agentPayout: pricing.agentPayout,
        adminCommission: pricing.adminCommission,
        partnerCategory: parentOrder.partnerCategory || PartnerCategory.LOCAL_STORE,
        distanceKm: pricing.distanceKm,
        slaPriority,
        priority: parentOrder.priority || 'NORMAL',
        status: 'SEARCHING_AGENT',
        // Copy customer data from parent order (critical for e-commerce)
        customerName: parentOrder.customerName || undefined,
        customerPhone: parentOrder.customerPhone || undefined,
        customerEmail: parentOrder.customerEmail || undefined,
        customerAddress: parentOrder.customerAddress || undefined,
        productType: parentOrder.productType || undefined,
        // Copy barcode/QR code from parent order (same physical label)
        barcode: parentOrder.barcode || undefined,
        qrCode: parentOrder.qrCode || undefined,
        // Copy PDF URL if available
        pdfUrl: parentOrder.pdfUrl || undefined,
        // Link to parent order for tracking
        transitLegs: {
          parentOrderId: parentOrderId,
          leg: 'FINAL_DELIVERY',
          fromWarehouse: destinationWarehouseId,
          toCustomer: true,
        } as any,
      } as any,
    });

    // Update parent order to mark that delivery order was created
    await prisma.order.update({
      where: { id: parentOrderId },
      data: {
        transitLegs: {
          ...(parentOrder.transitLegs as any || {}),
          deliveryOrderId: orderId,
          deliveryOrderCreatedAt: new Date().toISOString(),
        } as any,
      } as any,
    });

    return deliveryOrder;
  },

  /**
   * Check if order has reached destination warehouse and create delivery order if needed
   */
  async checkAndCreateDeliveryOrder(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        partner: true,
        logisticsProvider: true,
        currentWarehouse: true,
      },
    });

    if (!order) {
      return null;
    }

    // Check if this is a logistics order with transit legs
    const transitLegs = order.transitLegs as any;
    if (!transitLegs || !Array.isArray(transitLegs)) {
      return null; // Not a logistics order
    }

    // Find leg 3 (DESTINATION_WAREHOUSE to DELIVERY)
    const leg3 = transitLegs.find((leg: any) => leg.leg === 3);
    if (!leg3) {
      return null; // No leg 3 found
    }

    // Check if order has reached destination warehouse
    const hasReachedDestination =
      order.status === OrderStatus.AT_WAREHOUSE ||
      order.status === OrderStatus.READY_FOR_PICKUP;

    // Check if current warehouse is the destination warehouse
    const isAtDestinationWarehouse =
      order.currentWarehouseId === leg3.warehouseId ||
      order.currentWarehouseId === leg3.destinationWarehouseId;

    // Check if delivery order already created
    const deliveryOrderAlreadyCreated = transitLegs.some(
      (leg: any) => leg.deliveryOrderId
    );

    if (
      hasReachedDestination &&
      isAtDestinationWarehouse &&
      !deliveryOrderAlreadyCreated &&
      leg3.finalDeliveryLat &&
      leg3.finalDeliveryLng
    ) {
      // Use transaction to prevent race condition
      try {
        return await prisma.$transaction(async (tx) => {
          // Double-check delivery order not created (within transaction)
          const currentOrder = await tx.order.findUnique({
            where: { id: orderId },
            select: { transitLegs: true },
          });

          const currentTransitLegs = currentOrder?.transitLegs as any;
          if (currentTransitLegs?.deliveryOrderId) {
            console.log(`[Logistics Order] Delivery order already created for ${orderId}`);
            return null; // Already created by another process
          }

          // Create delivery order
          return await this.createDeliveryOrderFromWarehouse(
            orderId,
            leg3.warehouseId || leg3.destinationWarehouseId,
            leg3.finalDeliveryLat,
            leg3.finalDeliveryLng,
            leg3.finalDeliveryAddress || 'Customer Address',
            leg3.finalDeliveryWarehouseId
          );
        });
      } catch (error: any) {
        console.error(`[Logistics Order] Failed to create delivery order for ${orderId}:`, error.message);
        return null;
      }
    }

    return null;
  },
};






















