import { prisma } from '../lib/prisma';
import { mailService } from './mail.service';
import { payoutService } from './payout.service';
import { logger } from '../lib/logger';

interface PayoutReminderResult {
  agentId: string;
  agentName: string;
  email: string;
  success: boolean;
  error?: string;
}

/**
 * Get agent's preferred payment method from their last payout or wallet
 */
async function getAgentPaymentMethod(agentId: string): Promise<{
  method: string;
  details?: string;
}> {
  // Try to get from last successful payout
  const lastPayout = await prisma.walletPayout.findFirst({
    where: {
      agentId,
      status: 'PROCESSED',
    },
    orderBy: {
      processedAt: 'desc',
    },
    select: {
      paymentMethod: true,
      upiId: true,
      bankAccount: true,
    },
  });

  if (lastPayout?.paymentMethod) {
    let details: string | undefined;
    if (lastPayout.paymentMethod === 'UPI' && lastPayout.upiId) {
      details = lastPayout.upiId;
    } else if (lastPayout.paymentMethod === 'BANK_TRANSFER' && lastPayout.bankAccount) {
      try {
        const bankDetails = typeof lastPayout.bankAccount === 'string' 
          ? JSON.parse(lastPayout.bankAccount) 
          : lastPayout.bankAccount;
        details = bankDetails.accountNumber || bankDetails.account || 'Bank Account';
      } catch {
        details = 'Bank Account';
      }
    }

    return {
      method: lastPayout.paymentMethod,
      details,
    };
  }

  // Default to UPI if no previous payout found
  return {
    method: 'UPI',
    details: 'Not configured',
  };
}

/**
 * Send weekly payout reminder emails to all agents with WEEKLY payout plan
 */
export async function sendWeeklyPayoutReminders(): Promise<PayoutReminderResult[]> {
  const results: PayoutReminderResult[] = [];
  
  try {
    logger.info('[Payout Reminder] Starting weekly payout reminder emails...');

    // Get all active agents with WEEKLY payout plan
    const agents = await prisma.agent.findMany({
      where: {
        payoutPlan: 'WEEKLY',
        isApproved: true,
        isBlocked: false,
        user: {
          email: {
            not: null,
          },
        },
      },
      include: {
        user: {
          select: {
            email: true,
            name: true,
          },
        },
        wallet: {
          select: {
            balance: true,
          },
        },
      },
    });

    logger.info(`[Payout Reminder] Found ${agents.length} agents with WEEKLY payout plan`);

    // Calculate current week (Monday to Sunday)
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Send reminders to each agent
    for (const agent of agents) {
      try {
        if (!agent.user?.email || !agent.user?.name) {
          results.push({
            agentId: agent.id,
            agentName: 'Unknown',
            email: agent.user?.email || 'N/A',
            success: false,
            error: 'Missing email or name',
          });
          continue;
        }

        // Calculate weekly payout
        const summary = await payoutService.calculateWeeklyPayout(agent.id, weekStart);

        // Skip if no earnings
        if (summary.totalEarnings <= 0) {
          logger.info(`[Payout Reminder] Skipping agent ${agent.id} - no earnings this week`);
          continue;
        }

        // Get payment method
        const paymentInfo = await getAgentPaymentMethod(agent.id);

        // Send email
        const emailSent = await mailService.sendWeeklyPayoutReminder({
          email: agent.user.email,
          name: agent.user.name,
          amount: summary.totalEarnings,
          periodStart: summary.periodStart,
          periodEnd: summary.periodEnd,
          orderCount: summary.orderCount,
          paymentMethod: paymentInfo.method,
          paymentDetails: paymentInfo.details,
        });

        if (emailSent) {
          logger.info(`[Payout Reminder] Weekly reminder sent to ${agent.user.email} (${agent.user.name})`);
          results.push({
            agentId: agent.id,
            agentName: agent.user.name,
            email: agent.user.email,
            success: true,
          });
        } else {
          results.push({
            agentId: agent.id,
            agentName: agent.user.name,
            email: agent.user.email,
            success: false,
            error: 'Failed to send email',
          });
        }
      } catch (error: any) {
        logger.error(`[Payout Reminder] Error sending weekly reminder to agent ${agent.id}:`, error);
        results.push({
          agentId: agent.id,
          agentName: agent.user?.name || 'Unknown',
          email: agent.user?.email || 'N/A',
          success: false,
          error: error?.message || 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`[Payout Reminder] Weekly reminders completed: ${successCount}/${results.length} successful`);

    return results;
  } catch (error: any) {
    logger.error('[Payout Reminder] Fatal error in sendWeeklyPayoutReminders:', error);
    throw error;
  }
}

/**
 * Send monthly payout reminder emails to all agents with MONTHLY payout plan
 */
export async function sendMonthlyPayoutReminders(): Promise<PayoutReminderResult[]> {
  const results: PayoutReminderResult[] = [];
  
  try {
    logger.info('[Payout Reminder] Starting monthly payout reminder emails...');

    // Get all active agents with MONTHLY payout plan
    const agents = await prisma.agent.findMany({
      where: {
        payoutPlan: 'MONTHLY',
        isApproved: true,
        isBlocked: false,
        user: {
          email: {
            not: null,
          },
        },
      },
      include: {
        user: {
          select: {
            email: true,
            name: true,
          },
        },
        wallet: {
          select: {
            balance: true,
          },
        },
      },
    });

    logger.info(`[Payout Reminder] Found ${agents.length} agents with MONTHLY payout plan`);

    // Calculate current month (1st to last day)
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    // Send reminders to each agent
    for (const agent of agents) {
      try {
        if (!agent.user?.email || !agent.user?.name) {
          results.push({
            agentId: agent.id,
            agentName: 'Unknown',
            email: agent.user?.email || 'N/A',
            success: false,
            error: 'Missing email or name',
          });
          continue;
        }

        // Calculate monthly payout
        const summary = await payoutService.calculateMonthlyPayout(agent.id, monthStart);

        // Skip if no earnings
        if (summary.totalEarnings <= 0) {
          logger.info(`[Payout Reminder] Skipping agent ${agent.id} - no earnings this month`);
          continue;
        }

        // Get payment method
        const paymentInfo = await getAgentPaymentMethod(agent.id);

        // Send email
        const emailSent = await mailService.sendMonthlyPayoutReminder({
          email: agent.user.email,
          name: agent.user.name,
          amount: summary.totalEarnings,
          periodStart: summary.periodStart,
          periodEnd: summary.periodEnd,
          orderCount: summary.orderCount,
          paymentMethod: paymentInfo.method,
          paymentDetails: paymentInfo.details,
        });

        if (emailSent) {
          logger.info(`[Payout Reminder] Monthly reminder sent to ${agent.user.email} (${agent.user.name})`);
          results.push({
            agentId: agent.id,
            agentName: agent.user.name,
            email: agent.user.email,
            success: true,
          });
        } else {
          results.push({
            agentId: agent.id,
            agentName: agent.user.name,
            email: agent.user.email,
            success: false,
            error: 'Failed to send email',
          });
        }
      } catch (error: any) {
        logger.error(`[Payout Reminder] Error sending monthly reminder to agent ${agent.id}:`, error);
        results.push({
          agentId: agent.id,
          agentName: agent.user?.name || 'Unknown',
          email: agent.user?.email || 'N/A',
          success: false,
          error: error?.message || 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`[Payout Reminder] Monthly reminders completed: ${successCount}/${results.length} successful`);

    return results;
  } catch (error: any) {
    logger.error('[Payout Reminder] Fatal error in sendMonthlyPayoutReminders:', error);
    throw error;
  }
}

/**
 * Send payout reminders for all agents (both weekly and monthly)
 * This is the main function to call on Sundays
 */
export async function sendAllPayoutReminders(): Promise<{
  weekly: PayoutReminderResult[];
  monthly: PayoutReminderResult[];
}> {
  logger.info('[Payout Reminder] Starting all payout reminder emails...');

  const [weeklyResults, monthlyResults] = await Promise.all([
    sendWeeklyPayoutReminders(),
    sendMonthlyPayoutReminders(),
  ]);

  const totalSent = weeklyResults.filter(r => r.success).length + monthlyResults.filter(r => r.success).length;
  const totalFailed = weeklyResults.filter(r => !r.success).length + monthlyResults.filter(r => !r.success).length;

  logger.info(`[Payout Reminder] All reminders completed: ${totalSent} sent, ${totalFailed} failed`);

  return {
    weekly: weeklyResults,
    monthly: monthlyResults,
  };
}

export const payoutReminderService = {
  sendWeeklyPayoutReminders,
  sendMonthlyPayoutReminders,
  sendAllPayoutReminders,
};


