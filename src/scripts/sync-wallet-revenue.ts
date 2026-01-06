import { prisma } from '../lib/prisma';
import { walletService } from '../services/wallet.service';

/**
 * Synchronize wallet balances with actual order data
 * Simple approach: Calculate totals from all delivered orders and credit wallets accordingly
 * - Agent gets 70% of total order amounts
 * - Admin gets 30% of total order amounts
 */
async function syncWalletAndRevenue() {
  console.log('🔄 Starting wallet synchronization...\n');

  try {
    // Get all delivered orders
    const deliveredOrders = await prisma.order.findMany({
      where: {
        status: 'DELIVERED',
        deliveredAt: { not: null },
      },
      select: {
        id: true,
        agentId: true,
        partnerId: true,
        payoutAmount: true,
        orderAmount: true,
        deliveredAt: true,
      },
      orderBy: {
        deliveredAt: 'asc',
      },
    });

    console.log(`📦 Found ${deliveredOrders.length} delivered orders\n`);

    if (deliveredOrders.length === 0) {
      console.log('✅ No delivered orders to sync. Exiting.');
      return;
    }

    // Track statistics
    let agentWalletsUpdated = 0;
    let adminWalletsUpdated = 0;
    let transactionsCreated = 0;
    let errors = 0;

    // Group orders by agent
    const agentOrders = new Map<string, typeof deliveredOrders>();
    let totalOrderAmount = 0;
    let totalAgentEarnings = 0;
    let totalAdminCommission = 0;

    for (const order of deliveredOrders) {
      // Calculate order amount (partner payment = 100%)
      let partnerPayment = order.orderAmount || 0;
      if (!partnerPayment && order.payoutAmount) {
        // If orderAmount is missing, calculate from payoutAmount (payoutAmount is 70% of orderAmount)
        partnerPayment = order.payoutAmount / 0.70;
      }

      if (partnerPayment > 0) {
        // Agent gets 70%
        const agentEarning = partnerPayment * 0.70;
        // Admin gets 30%
        const adminCommission = partnerPayment * 0.30;

        totalOrderAmount += partnerPayment;
        totalAgentEarnings += agentEarning;
        totalAdminCommission += adminCommission;

        if (order.agentId) {
          if (!agentOrders.has(order.agentId)) {
            agentOrders.set(order.agentId, []);
          }
          agentOrders.get(order.agentId)!.push(order);
        }
      }
    }

    console.log(`💰 Total Order Amount: ${totalOrderAmount.toFixed(2)}`);
    console.log(`   Agent Earnings (70%): ${totalAgentEarnings.toFixed(2)}`);
    console.log(`   Admin Commission (30%): ${totalAdminCommission.toFixed(2)}`);
    
    if (totalOrderAmount === 0) {
      console.log(`\n⚠️  WARNING: Total order amount is 0!`);
      console.log(`   This might mean orders don't have orderAmount or payoutAmount set.`);
      console.log(`   Checking order details...`);
      for (const order of deliveredOrders.slice(0, 5)) {
        console.log(`   Order ${order.id.substring(0, 8)}: orderAmount=${order.orderAmount || 'null'}, payoutAmount=${order.payoutAmount || 'null'}`);
      }
    }
    console.log('');

    // Sync agent wallets
    console.log('💰 Syncing agent wallets...');
    for (const [agentId, orders] of Array.from(agentOrders.entries())) {
      try {
        const wallet = await walletService.getAgentWallet(agentId);

        // Calculate total earnings for this agent from their orders
        let agentTotalEarnings = 0;
        for (const order of orders) {
          let partnerPayment = order.orderAmount || 0;
          if (!partnerPayment && order.payoutAmount) {
            partnerPayment = order.payoutAmount / 0.70;
          }
          if (partnerPayment > 0) {
            agentTotalEarnings += partnerPayment * 0.70;
          }
        }

        // Get all existing transactions
        let existingTransactions: any[] = [];
        try {
          const result = await walletService.getWalletTransactions('AGENT_WALLET', wallet.id, 10000, 0);
          existingTransactions = result.transactions || [];
        } catch (error: any) {
          console.warn(`  ⚠️  Could not fetch transactions for agent ${agentId.substring(0, 8)}: ${error.message}`);
        }

        // Calculate actual balance from transactions
        let actualBalance = 0;
        let actualTotalEarned = 0;
        let actualTotalPaidOut = 0;

        const sortedTransactions = [...existingTransactions].sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        for (const txn of sortedTransactions) {
          if (txn.type === 'EARNING') {
            actualBalance += txn.amount;
            actualTotalEarned += txn.amount;
          } else if (txn.type === 'PAYOUT') {
            actualBalance += txn.amount; // already negative
            actualTotalPaidOut += Math.abs(txn.amount);
          }
        }

        // Update wallet if balance doesn't match expected earnings
        if (Math.abs(actualTotalEarned - agentTotalEarnings) > 0.01) {
          console.log(`  📊 Agent ${agentId.substring(0, 8)}: Earnings mismatch`);
          console.log(`     Expected: ${agentTotalEarnings.toFixed(2)}, Actual: ${actualTotalEarned.toFixed(2)}`);

          // Create a single adjustment transaction for the difference
          const difference = agentTotalEarnings - actualTotalEarned;
          if (Math.abs(difference) > 0.01) {
            const balanceBefore = actualBalance;
            const balanceAfter = actualBalance + difference;

            try {
              await prisma.walletTransaction.create({
                data: {
                  walletType: 'AGENT_WALLET',
                  agentWalletId: wallet.id,
                  amount: difference,
                  type: 'EARNING',
                  description: `Wallet sync adjustment - ${orders.length} orders`,
                  balanceBefore,
                  balanceAfter,
                  status: 'COMPLETED',
                },
              });
              transactionsCreated++;

              // Update wallet
              await prisma.agentWallet.update({
                where: { agentId },
                data: {
                  balance: balanceAfter,
                  totalEarned: agentTotalEarnings,
                  totalPaidOut: actualTotalPaidOut,
                },
              });

              agentWalletsUpdated++;
              console.log(`     ✅ Adjusted by ${difference.toFixed(2)}`);
            } catch (error: any) {
              console.error(`  ❌ Failed to create adjustment transaction: ${error.message}`);
              errors++;
            }
          }
        } else {
          // Just update wallet balance if it's incorrect
          if (Math.abs(wallet.balance - actualBalance) > 0.01) {
            await prisma.agentWallet.update({
              where: { agentId },
              data: {
                balance: actualBalance,
                totalEarned: actualTotalEarned,
                totalPaidOut: actualTotalPaidOut,
              },
            });
            agentWalletsUpdated++;
            console.log(`  ✅ Agent ${agentId.substring(0, 8)}: Balance corrected`);
          }
        }
      } catch (error: any) {
        console.error(`  ❌ Error processing agent ${agentId.substring(0, 8)}: ${error.message}`);
        errors++;
      }
    }

    // Sync admin wallet
    console.log('\n💰 Syncing admin wallet...');
    try {
      const adminWallet = await walletService.getAdminWallet();

      // Get all existing admin transactions
      let existingAdminTransactions: any[] = [];
      try {
        const result = await walletService.getWalletTransactions('ADMIN_WALLET', adminWallet.id, 10000, 0);
        existingAdminTransactions = result.transactions || [];
      } catch (error: any) {
        console.warn(`  ⚠️  Could not fetch admin transactions: ${error.message}`);
      }

      // Calculate actual balance from transactions
      let actualBalance = 0;
      let actualTotalDeposited = 0;
      let actualTotalPaidOut = 0;

      console.log(`  📊 Found ${existingAdminTransactions.length} existing admin transactions`);

      const sortedAdminTransactions = [...existingAdminTransactions].sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      for (const txn of sortedAdminTransactions) {
        if (txn.type === 'COMMISSION') {
          actualBalance += txn.amount;
          actualTotalDeposited += txn.amount;
        } else if (txn.type === 'PAYOUT') {
          actualBalance += txn.amount; // already negative
          actualTotalPaidOut += Math.abs(txn.amount);
        }
      }

      console.log(`  📊 Current admin wallet state:`);
      console.log(`     Balance: ${adminWallet.balance}`);
      console.log(`     Total Deposited: ${adminWallet.totalDeposited}`);
      console.log(`     Calculated from transactions: Balance=${actualBalance.toFixed(2)}, Deposited=${actualTotalDeposited.toFixed(2)}`);
      console.log(`     Expected from orders: ${totalAdminCommission.toFixed(2)}`);

      // Update admin wallet if commission doesn't match expected
      if (Math.abs(actualTotalDeposited - totalAdminCommission) > 0.01) {
        console.log(`  📊 Admin wallet: Commission mismatch`);
        console.log(`     Expected: ${totalAdminCommission.toFixed(2)}, Actual: ${actualTotalDeposited.toFixed(2)}`);

        // Create a single adjustment transaction for the difference
        const difference = totalAdminCommission - actualTotalDeposited;
        if (Math.abs(difference) > 0.01) {
          const balanceBefore = actualBalance;
          const balanceAfter = actualBalance + difference;

          try {
            await prisma.walletTransaction.create({
              data: {
                walletType: 'ADMIN_WALLET',
                adminWalletId: adminWallet.id,
                amount: difference,
                type: 'COMMISSION',
                description: `Wallet sync adjustment - ${deliveredOrders.length} orders`,
                balanceBefore,
                balanceAfter,
                status: 'COMPLETED',
              },
            });
            transactionsCreated++;

            // Update wallet
            await prisma.adminWallet.update({
              where: { id: adminWallet.id },
              data: {
                balance: balanceAfter,
                totalDeposited: totalAdminCommission,
                totalPaidOut: actualTotalPaidOut,
              },
            });

            adminWalletsUpdated++;
            console.log(`     ✅ Adjusted by ${difference.toFixed(2)}`);
          } catch (error: any) {
            console.error(`  ❌ Failed to create adjustment transaction: ${error.message}`);
            console.error(`  Error details:`, error);
            errors++;
          }
        }
      } else {
        // Just update wallet balance if it's incorrect (even if transactions match)
        if (Math.abs(adminWallet.balance - actualBalance) > 0.01 ||
            Math.abs(adminWallet.totalDeposited - actualTotalDeposited) > 0.01 ||
            Math.abs(adminWallet.totalPaidOut - actualTotalPaidOut) > 0.01) {
          
          await prisma.adminWallet.update({
            where: { id: adminWallet.id },
            data: {
              balance: actualBalance,
              totalDeposited: actualTotalDeposited,
              totalPaidOut: actualTotalPaidOut,
            },
          });
          adminWalletsUpdated++;
          console.log(`  ✅ Admin wallet: Balance corrected`);
          console.log(`     Balance: ${adminWallet.balance} → ${actualBalance}`);
          console.log(`     Total Deposited: ${adminWallet.totalDeposited} → ${actualTotalDeposited}`);
        } else {
          console.log(`  ✅ Admin wallet: Already in sync`);
        }
      }
    } catch (error: any) {
      console.error(`  ❌ Error processing admin wallet: ${error.message}`);
      errors++;
    }

    // Print summary
    console.log('\n✅ Synchronization complete!\n');
    console.log('📊 Summary:');
    console.log(`   Total Order Amount: ${totalOrderAmount.toFixed(2)}`);
    console.log(`   Agent Earnings (70%): ${totalAgentEarnings.toFixed(2)}`);
    console.log(`   Admin Commission (30%): ${totalAdminCommission.toFixed(2)}`);
    console.log(`   Agent wallets updated: ${agentWalletsUpdated}`);
    console.log(`   Admin wallets updated: ${adminWalletsUpdated}`);
    console.log(`   Adjustment transactions created: ${transactionsCreated}`);
    console.log(`   Errors: ${errors}\n`);

  } catch (error: any) {
    console.error('❌ Synchronization failed:', error);
    throw error; // Re-throw instead of process.exit when called from API
  } finally {
    // Only disconnect if running as standalone script
    if (require.main === module) {
      await prisma.$disconnect();
    }
  }
}

// Run if called directly
if (require.main === module) {
  syncWalletAndRevenue()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

export { syncWalletAndRevenue };

