import { prisma } from '../lib/prisma';
import { OrderStatus } from '@prisma/client';

/**
 * Service to check for delayed orders and update their status
 */
export const delayCheckerService = {
  /**
   * Check all active orders and mark them as delayed if they exceed estimated duration
   */
  async checkDelayedOrders() {
    try {
      const activeOrders = await prisma.order.findMany({
        where: {
          status: {
            in: ['PICKED_UP', 'OUT_FOR_DELIVERY'],
          },
          pickedUpAt: {
            not: null,
          },
          estimatedDuration: {
            not: null,
          },
        },
        select: {
          id: true,
          pickedUpAt: true,
          estimatedDuration: true,
          status: true,
        },
      });

      const now = new Date();
      const delayedOrders: string[] = [];

      for (const order of activeOrders) {
        if (!order.pickedUpAt || !order.estimatedDuration) continue;

        const elapsedMinutes = Math.floor(
          (now.getTime() - order.pickedUpAt.getTime()) / 60000
        );

        if (elapsedMinutes > order.estimatedDuration && order.status !== 'DELAYED') {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'DELAYED' },
            select: { id: true, status: true }, // Only select fields we need
          });
          delayedOrders.push(order.id);
        }
      }

      // Orders marked as delayed

      return { checked: activeOrders.length, delayed: delayedOrders.length };
    } catch (error) {
      console.error('[Delay Checker] Error checking delayed orders:', error);
      throw error;
    }
  },

  /**
   * Check if a specific order is delayed and update status
   */
  async checkOrderDelay(orderId: string): Promise<boolean> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          pickedUpAt: true,
          estimatedDuration: true,
          status: true,
          deliveredAt: true,
          cancelledAt: true,
        },
      });

      if (!order || !order.pickedUpAt || !order.estimatedDuration) {
        return false;
      }

      // Don't check if order is already delivered or cancelled
      if (order.deliveredAt || order.cancelledAt) {
        return false;
      }

      const elapsedMinutes = Math.floor(
        (new Date().getTime() - order.pickedUpAt.getTime()) / 60000
      );

      const isDelayed = elapsedMinutes > order.estimatedDuration;

      // Update status if delayed and not already marked
      if (isDelayed && order.status !== 'DELAYED' && order.status !== 'DELIVERED' && order.status !== 'CANCELLED') {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'DELAYED' },
          select: { id: true, status: true }, // Only select fields we need
        });
        return true;
      }

      // If not delayed but status is DELAYED, revert to OUT_FOR_DELIVERY
      if (!isDelayed && order.status === 'DELAYED') {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'OUT_FOR_DELIVERY' },
          select: { id: true, status: true }, // Only select fields we need
        });
        return false;
      }

      return isDelayed;
    } catch (error) {
      console.error('[Delay Checker] Error checking order delay:', error);
      return false;
    }
  },

  /**
   * Get elapsed time and remaining time for an order
   */
  getOrderTiming(order: { pickedUpAt: Date | null; estimatedDuration: number | null }) {
    if (!order.pickedUpAt || !order.estimatedDuration) {
      return {
        elapsedMinutes: 0,
        remainingMinutes: order.estimatedDuration || 0,
        isDelayed: false,
        elapsedTime: '0:00',
        remainingTime: order.estimatedDuration ? `${order.estimatedDuration}:00` : 'N/A',
      };
    }

    const now = new Date();
    const elapsedMs = now.getTime() - order.pickedUpAt.getTime();
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const remainingMinutes = Math.max(0, order.estimatedDuration - elapsedMinutes);
    const isDelayed = elapsedMinutes > order.estimatedDuration;

    const formatTime = (minutes: number) => {
      const hrs = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}` : `${mins}:00`;
    };

    return {
      elapsedMinutes,
      remainingMinutes,
      isDelayed,
      elapsedTime: formatTime(elapsedMinutes),
      remainingTime: formatTime(remainingMinutes),
    };
  },

  /**
   * Stop delivery timers for all active orders by marking them as delivered
   * This will stop the timer UI components and prevent further delay checks
   */
  async stopAllActiveDeliveryTimers() {
    try {
      const now = new Date();
      
      // Find all active orders with timers running (have been picked up but not delivered)
      const activeOrders = await prisma.order.findMany({
        where: {
          status: {
            in: [OrderStatus.PICKED_UP, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELAYED],
          },
          pickedUpAt: {
            not: null,
          },
          deliveredAt: null,
          cancelledAt: null,
        },
        select: {
          id: true,
          pickedUpAt: true,
          estimatedDuration: true,
          status: true,
          agentId: true,
        },
      });

      if (activeOrders.length === 0) {
        return {
          success: true,
          message: 'No active orders with running timers found',
          stopped: 0,
        };
      }

      const stoppedOrders: string[] = [];
      const errors: Array<{ orderId: string; error: string }> = [];

      for (const order of activeOrders) {
        try {
          if (!order.pickedUpAt) continue;

          // Calculate actual duration
          const elapsedMs = now.getTime() - order.pickedUpAt.getTime();
          const actualDuration = Math.floor(elapsedMs / 60000); // in minutes

          // Update order to DELIVERED status
          await prisma.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.DELIVERED,
              deliveredAt: now,
              actualDuration,
            },
          });

          // Update agent status if they have this as current order
          if (order.agentId) {
            const agent = await prisma.agent.findUnique({
              where: { id: order.agentId },
              select: { currentOrderId: true },
            });

            if (agent?.currentOrderId === order.id) {
              await prisma.agent.update({
                where: { id: order.agentId },
                data: {
                  currentOrderId: null,
                  status: 'ONLINE',
                },
              });
            }
          }

          stoppedOrders.push(order.id);
        } catch (error: any) {
          console.error(`[Stop Timers] Error stopping timer for order ${order.id}:`, error);
          errors.push({
            orderId: order.id,
            error: error.message || 'Unknown error',
          });
        }
      }

      return {
        success: true,
        message: `Stopped delivery timers for ${stoppedOrders.length} order(s)`,
        stopped: stoppedOrders.length,
        total: activeOrders.length,
        orderIds: stoppedOrders,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      console.error('[Stop Timers] Error stopping delivery timers:', error);
      throw error;
    }
  },
};

