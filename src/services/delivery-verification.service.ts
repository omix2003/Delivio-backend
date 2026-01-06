import { prisma } from '../lib/prisma';
import crypto from 'crypto';

/**
 * Generate OTP for delivery verification
 */
export function generateOTP(length: number = 6): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

/**
 * Generate QR code for delivery verification
 */
export function generateDeliveryQRCode(orderId: string, otp: string): string {
  return `DELIVERY:${orderId}:${otp}`;
}

/**
 * Generate delivery verification codes (OTP and QR) for an order
 */
export async function generateDeliveryVerification(orderId: string) {
  const otp = generateOTP(6);
  const qrCode = generateDeliveryQRCode(orderId, otp);
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30); // OTP expires in 30 minutes

  return await prisma.order.update({
    where: { id: orderId },
    data: {
      deliveryOtp: otp,
      deliveryQrCode: qrCode,
      otpExpiresAt: expiresAt,
    },
  });
}

/**
 * Verify delivery using OTP
 */
export async function verifyDeliveryWithOTP(orderId: string, otp: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  if (!order.deliveryOtp) {
    throw new Error('Delivery OTP not generated for this order');
  }

  if (order.deliveryOtp !== otp) {
    throw new Error('Invalid OTP');
  }

  if (order.otpExpiresAt && new Date() > order.otpExpiresAt) {
    throw new Error('OTP has expired');
  }

  // Verify delivery
  return await prisma.order.update({
    where: { id: orderId },
    data: {
      verifiedAt: new Date(),
      verificationMethod: 'OTP',
      status: 'DELIVERED',
      deliveredAt: order.deliveredAt || new Date(),
    },
  });
}

/**
 * Verify delivery using QR code
 */
export async function verifyDeliveryWithQR(qrCode: string) {
  // Parse QR code: DELIVERY:orderId:otp
  const parts = qrCode.split(':');
  if (parts.length !== 3 || parts[0] !== 'DELIVERY') {
    throw new Error('Invalid QR code format');
  }

  const orderId = parts[1];
  const otp = parts[2];

  return await verifyDeliveryWithOTP(orderId, otp);
}

/**
 * Get delivery verification details for an order
 */
export async function getDeliveryVerification(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      deliveryOtp: true,
      deliveryQrCode: true,
      otpExpiresAt: true,
      verifiedAt: true,
      verificationMethod: true,
      status: true,
    },
  });

  return order;
}

export const deliveryVerificationService = {
  generateOTP,
  generateDeliveryQRCode,
  generateDeliveryVerification,
  verifyDeliveryWithOTP,
  verifyDeliveryWithQR,
  getDeliveryVerification,
};



