import { prisma } from '../lib/prisma';

/**
 * Check if an order is delayed and update its status accordingly
 * An order is considered delayed if:
 * - It has been picked up (pickedUpAt is set)
 * - It has an estimatedDuration
 * - The elapsed time since pickup exceeds the estimatedDuration
 * - Status is not already DELIVERED or CANCELLED
 */
export async function checkAndUpdateDelayedStatus(orderId: string): Promise<boolean> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        pickedUpAt: true,
        estimatedDuration: true,
        deliveredAt: true,
        cancelledAt: true,
      },
    });

    if (!order) {
      return false;
    }

    // Don't check if order is already delivered or cancelled
    if (order.deliveredAt || order.cancelledAt) {
      return false;
    }

    // Only check if order has been picked up
    if (!order.pickedUpAt) {
      return false;
    }

    // Only check if order has an estimated duration
    if (!order.estimatedDuration) {
      return false;
    }

    // Calculate elapsed time since pickup (in minutes)
    const elapsedMinutes = Math.floor(
      (new Date().getTime() - order.pickedUpAt.getTime()) / 60000
    );

    // Check if order is delayed
    const isDelayed = elapsedMinutes > order.estimatedDuration;

    // Update status if delayed and not already marked as delayed
    if (isDelayed && order.status !== 'DELAYED') {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'DELAYED' },
      });
      return true;
    }

    // If not delayed but status is DELAYED, revert to OUT_FOR_DELIVERY
    if (!isDelayed && order.status === 'DELAYED') {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'OUT_FOR_DELIVERY' },
      });
      return false;
    }

    return isDelayed;
  } catch (error) {
    console.error('[Delay Service] Error checking delayed status:', error);
    return false;
  }
}

/**
 * Get elapsed time since pickup (in minutes)
 */
export function getElapsedTimeSincePickup(pickedUpAt: Date | null): number | null {
  if (!pickedUpAt) {
    return null;
  }
  return Math.floor((new Date().getTime() - pickedUpAt.getTime()) / 60000);
}

/**
 * Check if order is currently delayed
 */
export function isOrderDelayed(
  pickedUpAt: Date | null,
  estimatedDuration: number | null,
  currentStatus: string
): boolean {
  if (!pickedUpAt || !estimatedDuration) {
    return false;
  }

  const elapsedMinutes = getElapsedTimeSincePickup(pickedUpAt);
  if (elapsedMinutes === null) {
    return false;
  }

  return elapsedMinutes > estimatedDuration || currentStatus === 'DELAYED';
}






