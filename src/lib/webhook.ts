import axios from 'axios';

export interface WebhookPayload {
  event: string;
  orderId: string;
  status: string;
  timestamp: string;
  data?: any;
}

/**
 * Send webhook notification to partner
 */
export const sendWebhook = async (
  webhookUrl: string,
  payload: WebhookPayload
): Promise<void> => {
  try {
    await axios.post(webhookUrl, payload, {
      timeout: 5000, // 5 second timeout
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DeliveryNetwork/1.0',
      },
    });
  } catch (error: any) {
    // Log error but don't throw - webhook failures shouldn't break the flow
    console.error('Webhook delivery failed:', {
      url: webhookUrl,
      event: payload.event,
      error: error.message,
    });
  }
};

/**
 * Notify partner about order status change
 */
export const notifyPartner = async (
  partnerId: string,
  event: string,
  orderId: string,
  status: string,
  additionalData?: any
): Promise<void> => {
  try {
    const { prisma } = await import('./prisma');
    
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { webhookUrl: true },
    });

    if (!partner || !partner.webhookUrl) {
      return; // No webhook configured
    }

    const payload: WebhookPayload = {
      event,
      orderId,
      status,
      timestamp: new Date().toISOString(),
      data: additionalData,
    };

    await sendWebhook(partner.webhookUrl, payload);
  } catch (error) {
    console.error('Failed to notify partner:', error);
  }
};


























