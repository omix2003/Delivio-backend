import * as admin from 'firebase-admin';
import { prisma } from '../lib/prisma';

// Initialize Firebase Admin if not already initialized
let fcmInitialized = false;

function initializeFCM() {
  if (fcmInitialized) {
    return;
  }

  // Check if Firebase credentials are provided
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!serviceAccount) {
    console.warn('⚠️  FCM not configured: FIREBASE_SERVICE_ACCOUNT not set');
    return;
  }

  try {
    const serviceAccountJson = JSON.parse(serviceAccount);
    
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountJson),
      });
    }
    
    fcmInitialized = true;
  } catch (error: any) {
    console.error('❌ Failed to initialize Firebase Admin:', error.message);
  }
}

/**
 * Send push notification to a user
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  if (!fcmInitialized) {
    initializeFCM();
  }

  if (!admin.apps.length) {
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    // Get user's FCM tokens
    const tokens = await prisma.notificationToken.findMany({
      where: {
        userId,
        isActive: true,
      },
      select: {
        fcmToken: true,
      },
    });

    if (tokens.length === 0) {
      return { success: false, error: 'No FCM tokens found for user' };
    }

    const fcmTokens = tokens.map((t) => t.fcmToken);

    // Send notification
    const message: admin.messaging.MulticastMessage = {
      notification: {
        title,
        body,
      },
      data: data || {},
      tokens: fcmTokens,
      android: {
        priority: 'high',
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Remove invalid tokens
    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(fcmTokens[idx]);
        }
      });

      if (failedTokens.length > 0) {
        await prisma.notificationToken.updateMany({
          where: {
            fcmToken: { in: failedTokens },
          },
          data: {
            isActive: false,
          },
        });
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error('[FCM] Error sending notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send order offer notification to agent
 */
export async function sendOrderOfferNotification(
  agentId: string,
  orderId: string,
  orderData: {
    pickupAddress?: string;
    dropAddress?: string;
    payoutAmount: number;
    distance?: number;
  }
): Promise<void> {
  // Get agent's user ID
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      userId: true,
    },
  });

  if (!agent) {
    console.warn(`[FCM] Agent ${agentId} not found`);
    return;
  }

  const distanceText = orderData.distance
    ? `${(orderData.distance / 1000).toFixed(1)}km away`
    : '';

  await sendPushNotification(
    agent.userId,
    'New Order Available',
    `$${orderData.payoutAmount.toFixed(2)} ${distanceText ? `- ${distanceText}` : ''}`,
    {
      type: 'ORDER_OFFER',
      orderId,
      payoutAmount: orderData.payoutAmount.toString(),
    }
  );
}

/**
 * Send order assignment notification to agent
 */
export async function sendOrderAssignedNotification(
  agentId: string,
  orderId: string
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      userId: true,
    },
  });

  if (!agent) {
    return;
  }

  await sendPushNotification(
    agent.userId,
    'Order Assigned',
    'You have been assigned a new order',
    {
      type: 'ORDER_ASSIGNED',
      orderId,
    }
  );
}

// Initialize on import
initializeFCM();
























