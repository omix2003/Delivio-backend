/**
 * Script to delete all existing payouts for an agent and create a fresh test payout
 */

import { prisma } from '../lib/prisma';

async function resetAndCreatePayout() {
  try {
    console.log('🔍 Finding agents with wallet balance...\n');

    // Find agents with wallets that have balance > 0
    const wallets = await prisma.agentWallet.findMany({
      where: {
        balance: { gt: 0 },
      },
      include: {
        agent: {
          include: {
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      take: 5,
    });

    let wallet;
    let agent;

    if (wallets.length === 0) {
      console.log('⚠️  No agents found with wallet balance > 0');
      console.log('🔍 Finding any agent to create test payout...\n');
      
      // Find any agent
      const anyAgent = await prisma.agent.findFirst({
        include: {
          user: {
            select: {
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      if (!anyAgent) {
        console.error('❌ No agents found in database. Please create an agent first.\n');
        await prisma.$disconnect();
        return;
      }

      agent = anyAgent;
      
      // Get or create wallet
      wallet = await prisma.agentWallet.findUnique({
        where: { agentId: agent.id },
      });

      if (!wallet) {
        wallet = await prisma.agentWallet.create({
          data: {
            agentId: agent.id,
            balance: 1000,
            totalEarned: 1000,
            totalPaidOut: 0,
            nextPayoutDate: new Date(),
          },
        });
        console.log(`✅ Created wallet for agent: ${agent.user?.name}\n`);
      } else {
        // Restore balance
        await prisma.agentWallet.update({
          where: { agentId: agent.id },
          data: {
            balance: 1000,
            totalEarned: wallet.totalEarned + 1000,
            totalPaidOut: 0,
            nextPayoutDate: new Date(),
          },
        });
        console.log(`✅ Restored wallet balance for agent: ${agent.user?.name}\n`);
        
        // Re-fetch wallet
        const refetchedWallet = await prisma.agentWallet.findUnique({
          where: { agentId: agent.id },
        });
        if (!refetchedWallet) {
          throw new Error('Failed to create/fetch wallet');
        }
        wallet = refetchedWallet;
      }
    } else {
      // Use first agent with balance
      wallet = wallets[0];
      agent = wallet.agent!;
    }

    if (!wallet || !agent) {
      throw new Error('Failed to get wallet or agent');
    }

    console.log(`✅ Found agent: ${agent.user?.name || 'Unknown'}`);
    console.log(`   Email: ${agent.user?.email || 'N/A'}`);
    console.log(`   Phone: ${agent.user?.phone || 'N/A'}`);
    console.log(`   Balance: ₹${wallet.balance}\n`);

    // Check agent's payout plan
    const agentRecord = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { payoutPlan: true },
    });

    const payoutPlan = agentRecord?.payoutPlan || 'WEEKLY';
    console.log(`   Payout Plan: ${payoutPlan}\n`);

    // Delete ALL existing payouts for this agent
    console.log('🗑️  Deleting all existing payouts for this agent...\n');
    const deleteResult = await prisma.walletPayout.deleteMany({
      where: {
        agentId: agent.id,
      },
    });
    console.log(`✅ Deleted ${deleteResult.count} existing payout(s).\n`);

    // If wallet balance is 0, restore it for testing
    if (wallet.balance === 0) {
      console.log('💰 Wallet balance is 0. Restoring balance for testing...\n');
      const testBalance = 1000; // Test amount
      await prisma.agentWallet.update({
        where: { agentId: agent.id },
        data: {
          balance: testBalance,
          totalEarned: wallet.totalEarned + testBalance,
          totalPaidOut: 0, // Reset paid out since we deleted payouts
        },
      });
      console.log(`✅ Restored wallet balance to ₹${testBalance}\n`);
      
      // Re-fetch wallet with updated balance
      const updatedWallet = await prisma.agentWallet.findUnique({
        where: { agentId: agent.id },
      });
      if (updatedWallet) {
        wallet.balance = updatedWallet.balance;
      }
    }

    // Calculate period based on payout plan
    const today = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    if (payoutPlan === 'MONTHLY') {
      // Use current month
      periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
      periodStart.setHours(0, 0, 0, 0);
      
      periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      periodEnd.setHours(23, 59, 59, 999);
    } else {
      // Use current week (Monday to Sunday)
      const dayOfWeek = today.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      
      periodStart = new Date(today);
      periodStart.setDate(today.getDate() - daysFromMonday);
      periodStart.setHours(0, 0, 0, 0);
      
      periodEnd = new Date(periodStart);
      periodEnd.setDate(periodStart.getDate() + 6);
      periodEnd.setHours(23, 59, 59, 999);
    }

    console.log(`📅 Creating fresh payout for period:`);
    console.log(`   Start: ${periodStart.toLocaleDateString()}`);
    console.log(`   End: ${periodEnd.toLocaleDateString()}\n`);

    // Create fresh test payout WITHOUT transactionId
    const payout = await prisma.walletPayout.create({
      data: {
        agentWalletId: wallet.id,
        agentId: agent.id,
        amount: wallet.balance,
        periodStart,
        periodEnd,
        status: 'PENDING', // Set to PENDING
        paymentMethod: 'UPI',
        upiId: 'test@upi', // Test UPI ID
        transactionId: null, // IMPORTANT: No transactionId so gateway will be called
        notes: JSON.stringify({
          purpose: 'Fresh test payout for Razorpay integration',
          agentName: agent.user?.name || 'Test Agent',
          agentEmail: agent.user?.email || 'test@example.com',
          agentPhone: agent.user?.phone || '9876543210',
        }),
      },
    });

    console.log('✅ Fresh test payout created successfully!\n');
    console.log('📋 Payout Details:');
    console.log(`   ID: ${payout.id}`);
    console.log(`   Agent: ${agent.user?.name || 'Unknown'}`);
    console.log(`   Amount: ₹${payout.amount}`);
    console.log(`   Status: ${payout.status}`);
    console.log(`   Payment Method: ${payout.paymentMethod}`);
    console.log(`   UPI ID: ${payout.upiId}`);
    console.log(`   Transaction ID: ${payout.transactionId || 'NONE (will be created by gateway)'}`);
    console.log(`   Period: ${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`);
    console.log(`   Payout Plan: ${payoutPlan}\n`);
    
    console.log('💡 You can now test processing this payout via the admin panel.');
    console.log(`   Agent ID: ${agent.id}`);
    console.log(`   Payout ID: ${payout.id}\n`);
    
    console.log('📝 To process this payout:');
    console.log(`   1. Go to Admin Wallet page`);
    console.log(`   2. Find this payout in the "Payout History" tab`);
    console.log(`   3. Click "Process Payout" button`);
    console.log(`   4. Check backend terminal for payment gateway logs`);
    console.log(`   5. You should see Razorpay API calls with valid email!\n`);

  } catch (error: any) {
    console.error('❌ Error resetting and creating payout:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
resetAndCreatePayout();

