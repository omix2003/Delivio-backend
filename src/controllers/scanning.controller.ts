import { Request, Response, NextFunction } from 'express';
import { barcodeService } from '../services/barcode.service';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/errors.util';
import { getAgentId } from '../utils/role.util';

export const scanningController = {
  // POST /api/agent/scan/barcode - Scan barcode
  async scanBarcode(req: Request, res: Response, next: NextFunction) {
    try {
      const { barcode } = req.body;
      const agentId = getAgentId(req);

      if (!barcode) {
        throw new AppError('Barcode is required', 400);
      }

      if (!agentId) {
        console.error('[SCAN BARCODE] Agent ID not found in request');
        throw new AppError('Agent ID not found. Please ensure you are logged in as an agent.', 401);
      }

      const order = await barcodeService.findOrderByBarcode(barcode);

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      // Allow scanning if:
      // 1. Order is assigned to this agent, OR
      // 2. Order is not assigned to anyone yet (available for pickup)
      // [NEW] Linked Delivery Order Logic
      // If order is not assigned to this agent, check if it's a parent logistics order with a linked delivery order
      let targetOrder = order;

      if (order.agentId && order.agentId !== agentId) {
        // Check for linked delivery order
        const transitLegs = order.transitLegs as any;
        if (Array.isArray(transitLegs)) {
          const deliveryLeg = transitLegs.find((leg: any) => leg.deliveryOrderId);
          if (deliveryLeg && deliveryLeg.deliveryOrderId) {
            const deliveryOrder = await prisma.order.findUnique({
              where: { id: deliveryLeg.deliveryOrderId },
              select: {
                id: true,
                status: true,
                agentId: true,
                pickupLat: true,
                pickupLng: true,
                dropLat: true,
                dropLng: true,
                payoutAmount: true,
                createdAt: true,
                partner: { select: { id: true, companyName: true, user: { select: { name: true, phone: true } } } },
                agent: { select: { id: true } } // needed for check
              }
            });

            if (deliveryOrder && (deliveryOrder.agentId === agentId || !deliveryOrder.agentId)) {
              // Found valid linked order! Use this instead.
              targetOrder = deliveryOrder as any;
            }
          }
        }
      }

      // Perform final check on the target order (whether it's original or linked)
      if (targetOrder.agentId && targetOrder.agentId !== agentId) {
        console.warn('[SCAN BARCODE] Order assigned to different agent:', {
          orderAgentId: targetOrder.agentId,
          requestingAgentId: agentId,
          scannedBarcode: barcode
        });
        throw new AppError('Order is assigned to another agent', 403);
      }

      // Use targetOrder for response
      const responseOrder = targetOrder;

      res.json({
        success: true,
        order: {
          id: responseOrder.id,
          trackingNumber: responseOrder.id.substring(0, 8).toUpperCase(),
          status: responseOrder.status,
          pickup: {
            latitude: responseOrder.pickupLat,
            longitude: responseOrder.pickupLng,
          },
          dropoff: {
            latitude: responseOrder.dropLat,
            longitude: responseOrder.dropLng,
          },
          partner: {
            name: responseOrder.partner.user.name,
            companyName: responseOrder.partner.companyName,
            phone: responseOrder.partner.user.phone,
          },
        },
      });
    } catch (error: any) {
      next(error);
    }
  },

  // POST /api/agent/scan/qr - Scan QR code
  async scanQRCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { qrCode } = req.body;
      const agentId = getAgentId(req);

      if (!qrCode) {
        throw new AppError('QR code is required', 400);
      }

      if (!agentId) {
        console.error('[SCAN QR] Agent ID not found in request');
        throw new AppError('Agent ID not found. Please ensure you are logged in as an agent.', 401);
      }

      const order = await barcodeService.findOrderByQRCode(qrCode);

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      // Allow scanning if:
      // 1. Order is assigned to this agent, OR
      // 2. Order is not assigned to anyone yet (available for pickup)
      // [NEW] Linked Delivery Order Logic
      // If order is not assigned to this agent, check if it's a parent logistics order with a linked delivery order
      let targetOrder = order;

      if (order.agentId && order.agentId !== agentId) {
        // Check for linked delivery order
        const transitLegs = order.transitLegs as any;
        if (Array.isArray(transitLegs)) {
          const deliveryLeg = transitLegs.find((leg: any) => leg.deliveryOrderId);
          if (deliveryLeg && deliveryLeg.deliveryOrderId) {
            const deliveryOrder = await prisma.order.findUnique({
              where: { id: deliveryLeg.deliveryOrderId },
              select: {
                id: true,
                status: true,
                agentId: true,
                pickupLat: true,
                pickupLng: true,
                dropLat: true,
                dropLng: true,
                payoutAmount: true,
                createdAt: true,
                partner: { select: { id: true, companyName: true, user: { select: { name: true, phone: true } } } },
                agent: { select: { id: true } } // needed for check
              }
            });

            if (deliveryOrder && (deliveryOrder.agentId === agentId || !deliveryOrder.agentId)) {
              // Found valid linked order! Use this instead.
              targetOrder = deliveryOrder as any;
            }
          }
        }
      }

      if (targetOrder.agentId && targetOrder.agentId !== agentId) {
        console.warn('[SCAN QR] Order assigned to different agent:', {
          orderAgentId: targetOrder.agentId,
          requestingAgentId: agentId,
        });
        throw new AppError('Order is assigned to another agent', 403);
      }

      // Use targetOrder for response
      const responseOrder = targetOrder;

      res.json({
        success: true,
        order: {
          id: responseOrder.id,
          trackingNumber: responseOrder.id.substring(0, 8).toUpperCase(),
          status: responseOrder.status,
          pickup: {
            latitude: responseOrder.pickupLat,
            longitude: responseOrder.pickupLng,
          },
          dropoff: {
            latitude: responseOrder.dropLat,
            longitude: responseOrder.dropLng,
          },
          partner: {
            name: responseOrder.partner.user.name,
            companyName: responseOrder.partner.companyName,
            phone: responseOrder.partner.user.phone,
          },
        },
      });
    } catch (error: any) {
      next(error);
    }
  },

  // POST /api/agent/scan/pickup-otp - Verify pickup with OTP (food delivery)
  async verifyPickupWithOTP(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId, otp } = req.body;
      const agentId = getAgentId(req);

      if (!orderId || !otp) {
        throw new AppError('Order ID and OTP are required', 400);
      }

      if (!agentId) {
        throw new AppError('Agent ID not found. Please ensure you are logged in as an agent.', 401);
      }

      // Find order and verify it's assigned to this agent
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          agentId: true,
          pickupOtp: true,
          partnerCategory: true,
          partner: {
            select: {
              id: true,
              companyName: true,
            },
          },
        },
      });

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      // Verify order is assigned to this agent
      if (order.agentId !== agentId) {
        throw new AppError('Order not assigned to you', 403);
      }

      // Verify it's a food delivery order
      if (order.partnerCategory !== 'FOOD_DELIVERY') {
        throw new AppError('OTP verification is only available for food delivery orders', 400);
      }

      // Verify OTP matches
      if (!order.pickupOtp || order.pickupOtp !== otp) {
        throw new AppError('Invalid OTP. Please check the 4-digit code and try again.', 400);
      }

      // Verify order is in correct status (ASSIGNED or SEARCHING_AGENT)
      if (order.status !== 'ASSIGNED' && order.status !== 'SEARCHING_AGENT') {
        throw new AppError(`Order cannot be picked up. Current status: ${order.status}`, 400);
      }

      // Update order status to PICKED_UP
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'PICKED_UP',
          pickedUpAt: new Date(),
          // Clear pickup OTP after successful verification
          pickupOtp: null,
        },
        select: {
          id: true,
          status: true,
          pickedUpAt: true,
        },
      });

      res.json({
        success: true,
        message: 'Pickup verified successfully',
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          pickedUpAt: updatedOrder.pickedUpAt,
        },
      });
    } catch (error: any) {
      next(error);
    }
  },
};
