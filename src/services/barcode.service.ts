import { prisma } from '../lib/prisma';
import crypto from 'crypto';

/**
 * Generate unique barcode for an order
 */
export function generateBarcode(orderId: string): string {
  // Generate a 12-digit barcode from order ID
  const hash = crypto.createHash('md5').update(orderId).digest('hex');
  return hash.substring(0, 12).toUpperCase();
}

/**
 * Generate QR code data for an order
 */
export function generateQRCode(orderId: string): string {
  // Generate QR code data (can be used to generate QR code image)
  return `ORDER:${orderId}`;
}

/**
 * Generate 4-digit OTP for pickup verification (food delivery)
 */
export function generatePickupOTP(): string {
  // Generate a random 4-digit OTP
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Assign barcode and QR code to an order
 * For food delivery orders, also generates pickup OTP
 */
export async function assignBarcodeToOrder(orderId: string) {
  const barcode = generateBarcode(orderId);
  const qrCode = generateQRCode(orderId);

  // Check if order is food delivery to generate pickup OTP
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { partnerCategory: true },
  });

  const updateData: any = {
    barcode,
    qrCode,
  };

  // Generate pickup OTP for food delivery orders
  if (order?.partnerCategory === 'FOOD_DELIVERY') {
    updateData.pickupOtp = generatePickupOTP();
  }

  try {
    // Try to update with barcode/qrCode (and pickupOtp for food delivery)
    return await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });
  } catch (error: any) {
    // If columns don't exist (P2022), log and return null
    if (error?.code === 'P2022' || error?.message?.includes('barcode') || error?.message?.includes('qrCode') || error?.message?.includes('pickupOtp')) {
      console.warn(`[Barcode Service] Barcode/QR code/pickupOtp columns not available for order ${orderId.substring(0, 8)}. Migration may need to run.`);
      // Return the order without barcode/qrCode (using select to avoid fetching barcode/qrCode)
      return await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Find order by barcode
 */
export async function findOrderByBarcode(barcode: string) {
  try {
    return await prisma.order.findUnique({
      where: { barcode },
      select: {
        id: true,
        status: true,
        agentId: true,
        pickupLat: true,
        pickupLng: true,
        dropLat: true,
        dropLng: true,
        payoutAmount: true,
        transitLegs: true,
        createdAt: true,
        partner: {
          select: {
            id: true,
            companyName: true,
            user: {
              select: {
                name: true,
                phone: true,
              },
            },
          },
        },
        agent: {
          select: {
            id: true,
            user: {
              select: {
                name: true,
                phone: true,
              },
            },
          },
        },
      },
    });
  } catch (error: any) {
    // If barcode column doesn't exist, return null
    if (error?.code === 'P2021' || error?.code === 'P2022' || error?.message?.includes('barcode')) {
      console.warn('[Barcode Service] Barcode column not available. Migration may need to run.');
      return null;
    }
    throw error;
  }
}

/**
 * Find order by QR code
 */
export async function findOrderByQRCode(qrCode: string) {
  // Handle both QR code format and direct order ID
  const orderId = qrCode.startsWith('ORDER:') ? qrCode.replace('ORDER:', '') : qrCode;

  try {
    // First try with qrCode in where clause
    return await prisma.order.findFirst({
      where: {
        OR: [
          { qrCode },
          { id: orderId },
        ],
      },
      select: {
        id: true,
        status: true,
        agentId: true,
        pickupLat: true,
        pickupLng: true,
        dropLat: true,
        dropLng: true,
        payoutAmount: true,
        transitLegs: true,
        createdAt: true,
        partner: {
          select: {
            id: true,
            companyName: true,
            user: {
              select: {
                name: true,
                phone: true,
              },
            },
          },
        },
        agent: {
          select: {
            id: true,
            user: {
              select: {
                name: true,
                phone: true,
              },
            },
          },
        },
      },
    });
  } catch (error: any) {
    // If qrCode column doesn't exist, fall back to finding by ID only
    if (error?.code === 'P2021' || error?.code === 'P2022' || error?.message?.includes('qrCode')) {
      console.warn('[Barcode Service] QR code column not available, falling back to order ID lookup.');
      return await prisma.order.findFirst({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          agentId: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          payoutAmount: true,
          transitLegs: true,
          createdAt: true,
          partner: {
            select: {
              id: true,
              companyName: true,
              user: {
                select: {
                  name: true,
                  phone: true,
                },
              },
            },
          },
          agent: {
            select: {
              id: true,
              user: {
                select: {
                  name: true,
                  phone: true,
                },
              },
            },
          },
        },
      });
    }
    throw error;
  }
}

export const barcodeService = {
  generateBarcode,
  generateQRCode,
  generatePickupOTP,
  assignBarcodeToOrder,
  findOrderByBarcode,
  findOrderByQRCode,
};



