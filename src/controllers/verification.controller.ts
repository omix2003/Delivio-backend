import { Request, Response, NextFunction } from 'express';
import { deliveryVerificationService } from '../services/delivery-verification.service';
import { AppError } from '../utils/errors.util';
import { getAgentId } from '../utils/role.util';

export const verificationController = {
  // POST /api/agent/orders/:id/generate-verification - Generate delivery verification codes
  async generateVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const agentId = getAgentId(req);
      if (!agentId) {
        throw new AppError('Agent ID not found', 401);
      }

      // Verify order is assigned to agent and is ready for delivery
      const { prisma } = await import('../lib/prisma');
      const order = await prisma.order.findUnique({
        where: { id },
      });

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      if (order.agentId !== agentId) {
        throw new AppError('Order not assigned to you', 403);
      }

      if (order.status !== 'OUT_FOR_DELIVERY' && order.status !== 'PICKED_UP') {
        throw new AppError('Order is not ready for delivery verification', 400);
      }

      const verification = await deliveryVerificationService.generateDeliveryVerification(id);

      res.json({
        success: true,
        otp: verification.deliveryOtp,
        qrCode: verification.deliveryQrCode,
        expiresAt: verification.otpExpiresAt,
      });
    } catch (error: any) {
      next(error);
    }
  },

  // POST /api/agent/orders/:id/verify-otp - Verify delivery with OTP
  async verifyWithOTP(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { otp } = req.body;
      const agentId = getAgentId(req);
      if (!agentId) {
        throw new AppError('Agent ID not found', 401);
      }

      if (!otp) {
        throw new AppError('OTP is required', 400);
      }

      // Verify order is assigned to agent
      const { prisma } = await import('../lib/prisma');
      const order = await prisma.order.findUnique({
        where: { id },
      });

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      if (order.agentId !== agentId) {
        throw new AppError('Order not assigned to you', 403);
      }

      const verifiedOrder = await deliveryVerificationService.verifyDeliveryWithOTP(id, otp);

      res.json({
        success: true,
        message: 'Delivery verified successfully',
        order: {
          id: verifiedOrder.id,
          status: verifiedOrder.status,
          verifiedAt: verifiedOrder.verifiedAt,
          verificationMethod: verifiedOrder.verificationMethod,
        },
      });
    } catch (error: any) {
      next(error);
    }
  },

  // POST /api/agent/orders/:id/verify-qr - Verify delivery with QR code
  async verifyWithQR(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { qrCode } = req.body;
      const agentId = getAgentId(req);
      if (!agentId) {
        throw new AppError('Agent ID not found', 401);
      }

      if (!qrCode) {
        throw new AppError('QR code is required', 400);
      }

      // Verify order is assigned to agent
      const { prisma } = await import('../lib/prisma');
      const order = await prisma.order.findUnique({
        where: { id },
      });

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      if (order.agentId !== agentId) {
        throw new AppError('Order not assigned to you', 403);
      }

      const verifiedOrder = await deliveryVerificationService.verifyDeliveryWithQR(qrCode);

      res.json({
        success: true,
        message: 'Delivery verified successfully',
        order: {
          id: verifiedOrder.id,
          status: verifiedOrder.status,
          verifiedAt: verifiedOrder.verifiedAt,
          verificationMethod: verifiedOrder.verificationMethod,
        },
      });
    } catch (error: any) {
      next(error);
    }
  },

  // GET /api/agent/orders/:id/verification - Get verification details
  async getVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const agentId = getAgentId(req);
      if (!agentId) {
        throw new AppError('Agent ID not found', 401);
      }

      // Verify order is assigned to agent
      const { prisma } = await import('../lib/prisma');
      const order = await prisma.order.findUnique({
        where: { id },
      });

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      if (order.agentId !== agentId) {
        throw new AppError('Order not assigned to you', 403);
      }

      const verification = await deliveryVerificationService.getDeliveryVerification(id);

      res.json({
        success: true,
        verification: {
          hasOtp: !!verification?.deliveryOtp,
          hasQrCode: !!verification?.deliveryQrCode,
          expiresAt: verification?.otpExpiresAt,
          verifiedAt: verification?.verifiedAt,
          verificationMethod: verification?.verificationMethod,
          isExpired: verification?.otpExpiresAt
            ? new Date() > verification.otpExpiresAt
            : false,
        },
      });
    } catch (error: any) {
      next(error);
    }
  },
};



