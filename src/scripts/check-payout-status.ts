import { prisma } from '../lib/prisma';

async function checkPayoutStatus() {
  try {
    console.log('🔍 Checking recent payouts...\n');

    // Get the most recent payouts
    const recentPayouts = await prisma.walletPayout.findMany({
      take: 5,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        agent: {
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (recentPayouts.length === 0) {
      console.log('⚠️  No payouts found in the database.');
      await prisma.$disconnect();
      return;
    }

    console.log(`✅ Found ${recentPayouts.length} recent payout(s):\n`);

    recentPayouts.forEach((payout, index) => {
      console.log(`📋 Payout #${index + 1}:`);
      console.log(`   ID: ${payout.id}`);
      console.log(`   Agent: ${payout.agent?.user?.name || 'Unknown'}`);
      console.log(`   Amount: ₹${payout.amount}`);
      console.log(`   Status: ${payout.status}`);
      console.log(`   Payment Method: ${payout.paymentMethod || 'N/A'}`);
      console.log(`   UPI ID: ${payout.upiId || 'N/A'}`);
      console.log(`   Transaction ID: ${payout.transactionId || 'N/A'}`);
      console.log(`   Period: ${payout.periodStart.toLocaleDateString()} - ${payout.periodEnd.toLocaleDateString()}`);
      console.log(`   Created: ${payout.createdAt.toLocaleString()}`);
      if (payout.processedAt) {
        console.log(`   Processed: ${payout.processedAt.toLocaleString()}`);
      }
      if (payout.failedAt) {
        console.log(`   Failed: ${payout.failedAt.toLocaleString()}`);
        console.log(`   Failure Reason: ${payout.failureReason || 'N/A'}`);
      }
      console.log('');
    });

    // Check agent wallet balance
    if (recentPayouts.length > 0) {
      const agentId = recentPayouts[0].agentId;
      const wallet = await prisma.agentWallet.findUnique({
        where: { agentId },
      });

      if (wallet) {
        console.log(`💰 Agent Wallet Status:`);
        console.log(`   Balance: ₹${wallet.balance}`);
        console.log(`   Total Earned: ₹${wallet.totalEarned}`);
        console.log(`   Total Paid Out: ₹${wallet.totalPaidOut}`);
        console.log(`   Next Payout Date: ${wallet.nextPayoutDate ? wallet.nextPayoutDate.toLocaleDateString() : 'N/A'}`);
      }
    }

    await prisma.$disconnect();
  } catch (error: any) {
    console.error('❌ Error checking payout status:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkPayoutStatus();




