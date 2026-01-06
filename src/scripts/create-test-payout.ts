/**
 * Script to create a test payout for an existing agent
 * This helps test the Razorpay payout integration
 */

import { prisma } from '../lib/prisma';

async function createTestPayout() {
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
              },
            },
          },
        },
      },
      take: 5,
    });

    if (wallets.length === 0) {
      console.log('❌ No agents found with wallet balance > 0');
      console.log('\n📝 Creating a test agent with balance...\n');

      // Find any agent
      const anyAgent = await prisma.agent.findFirst({
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      if (!anyAgent) {
        console.error('❌ No agents found in database. Please create an agent first.');
        process.exit(1);
      }

      // Get or create wallet for this agent
      let wallet = await prisma.agentWallet.findUnique({
        where: { agentId: anyAgent.id },
      });

      if (!wallet) {
        wallet = await prisma.agentWallet.create({
          data: {
            agentId: anyAgent.id,
            balance: 1000, // Test balance
            totalEarned: 1000,
            totalPaidOut: 0,
            nextPayoutDate: new Date(), // Ready for payout
          },
        });
        console.log(`✅ Created wallet for agent: ${anyAgent.user.name}`);
      } else {
        // Update balance if needed
        if (wallet.balance === 0) {
          await prisma.agentWallet.update({
            where: { agentId: anyAgent.id },
            data: {
              balance: 1000,
              totalEarned: wallet.totalEarned + 1000,
            },
          });
          console.log(`✅ Updated wallet balance for agent: ${anyAgent.user.name}`);
        }
      }

      // Re-fetch wallet
      wallet = await prisma.agentWallet.findUnique({
        where: { agentId: anyAgent.id },
      })!;

      // Create test payout
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const payout = await prisma.walletPayout.create({
        data: {
          agentWalletId: wallet!.id,
          agentId: anyAgent.id,
          amount: wallet!.balance,
          periodStart: weekStart,
          periodEnd: weekEnd,
          status: 'PENDING', // Set to PENDING so it can be processed
          paymentMethod: 'UPI',
          upiId: 'test@upi', // Test UPI ID
          notes: 'Test payout for Razorpay integration',
        },
      });

      console.log('\n✅ Test payout created successfully!\n');
      console.log('📋 Payout Details:');
      console.log(`   ID: ${payout.id}`);
      console.log(`   Agent: ${anyAgent.user.name} (${anyAgent.user.email})`);
      console.log(`   Amount: ₹${payout.amount}`);
      console.log(`   Status: ${payout.status}`);
      console.log(`   Payment Method: ${payout.paymentMethod}`);
      console.log(`   UPI ID: ${payout.upiId}`);
      console.log(`   Period: ${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}`);
      console.log('\n💡 You can now test processing this payout via API or admin panel.');
      console.log(`   Agent ID: ${anyAgent.id}`);
      console.log(`   Payout ID: ${payout.id}\n`);

      return;
    }

    // Use first agent with balance
    const wallet = wallets[0];
    const agent = wallet.agent!;

    console.log(`✅ Found agent: ${agent.user?.name} with balance: ₹${wallet.balance}\n`);

    // Calculate week period
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Check if payout already exists for this period
    const existingPayout = await prisma.walletPayout.findUnique({
      where: {
        agentId_periodStart_periodEnd: {
          agentId: agent.id,
          periodStart: weekStart,
          periodEnd: weekEnd,
        },
      },
    });

    if (existingPayout) {
      console.log('⚠️  Payout already exists for this period.');
      console.log(`   Payout ID: ${existingPayout.id}`);
      console.log(`   Status: ${existingPayout.status}`);
      console.log(`   Amount: ₹${existingPayout.amount}`);
      
      if (existingPayout.status === 'PROCESSED') {
        console.log('\n💡 This payout is already processed. You can:');
        console.log('   1. Wait for next payout period');
        console.log('   2. Create a payout for a different period');
        console.log('   3. Update this payout status to PENDING for testing\n');
      } else {
        console.log('\n💡 You can process this payout via API or admin panel.');
        console.log(`   Agent ID: ${agent.id}`);
        console.log(`   Payout ID: ${existingPayout.id}\n`);
      }
      return;
    }

    // Create test payout
    const payout = await prisma.walletPayout.create({
      data: {
        agentWalletId: wallet.id,
        agentId: agent.id,
        amount: wallet.balance,
        periodStart: weekStart,
        periodEnd: weekEnd,
        status: 'PENDING', // Set to PENDING so it can be processed
        paymentMethod: 'UPI',
        upiId: 'test@upi', // Test UPI ID
        notes: 'Test payout for Razorpay integration',
      },
    });

    console.log('✅ Test payout created successfully!\n');
    console.log('📋 Payout Details:');
    console.log(`   ID: ${payout.id}`);
    console.log(`   Agent: ${agent.user?.name}`);
    console.log(`   Amount: ₹${payout.amount}`);
    console.log(`   Status: ${payout.status}`);
    console.log(`   Payment Method: ${payout.paymentMethod}`);
    console.log(`   UPI ID: ${payout.upiId}`);
    console.log(`   Period: ${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}`);
    console.log('\n💡 You can now test processing this payout via API or admin panel.');
    console.log(`   Agent ID: ${agent.id}`);
    console.log(`   Payout ID: ${payout.id}\n`);
    console.log('📝 To process this payout, use:');
    console.log(`   POST /api/admin/payouts/process`);
    console.log(`   Body: { "agentId": "${agent.id}", "paymentMethod": "UPI", "upiId": "test@upi" }\n`);

  } catch (error: any) {
    console.error('❌ Error creating test payout:', error);
    if (error.code === 'P2002') {
      console.error('   Payout already exists for this period.');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createTestPayout();




