/**
 * Script to create a fresh test payout for testing Razorpay integration
 * This deletes any existing payout for the current period and creates a new one
 */

import { prisma } from '../lib/prisma';

async function createFreshTestPayout() {
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
      console.log('🔍 Looking for any agent to create a test payout...\n');
      
      // Find any agent (even without balance)
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
        console.log('❌ No agents found in the system.\n');
        await prisma.$disconnect();
        return;
      }
      
      agent = anyAgent;
      
      // Get or create wallet for this agent
      wallet = await prisma.agentWallet.findUnique({
        where: { agentId: agent.id },
      });
      
      if (!wallet) {
        console.log(`📦 Creating wallet for agent ${agent.user?.name || 'Unknown'}...\n`);
        wallet = await prisma.agentWallet.create({
          data: {
            agentId: agent.id,
            balance: 1000, // Default test balance
            totalEarned: 1000,
          },
        });
      } else if (wallet.balance <= 0) {
        console.log(`💰 Restoring wallet balance for testing (was ₹${wallet.balance})...\n`);
        wallet = await prisma.agentWallet.update({
          where: { id: wallet.id },
          data: {
            balance: 1000, // Restore to test balance
            totalEarned: Math.max(wallet.totalEarned, 1000),
          },
        });
      }
    } else {
      // Use first agent with balance
      wallet = wallets[0];
      agent = wallet.agent!;
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

    console.log(`📅 Checking for existing payouts for agent ${agent.id}...\n`);

    // Delete ALL existing payouts for this agent to ensure clean state
    console.log('🗑️  Deleting all existing payouts for this agent...\n');
    const deleteResult = await prisma.walletPayout.deleteMany({
      where: { agentId: agent.id },
    });
    console.log(`✅ Deleted ${deleteResult.count} existing payout(s).\n`);

    // Create fresh test payout WITHOUT transactionId
    // This ensures the payment gateway will be called
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
    console.log(`   5. You should see Razorpay API calls in the logs!\n`);

  } catch (error: any) {
    console.error('❌ Error creating fresh test payout:', error);
    if (error.code === 'P2002') {
      console.error('   Payout already exists for this period.');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createFreshTestPayout();
