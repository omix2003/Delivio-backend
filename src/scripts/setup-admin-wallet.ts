/**
 * Script to ensure admin wallet has sufficient balance for testing payouts
 */

import { prisma } from '../lib/prisma';

async function setupAdminWallet() {
  try {
    console.log('🔍 Checking admin wallet...\n');

    // Get or create admin wallet
    let adminWallet = await prisma.adminWallet.findFirst();

    if (!adminWallet) {
      console.log('📦 Creating admin wallet...\n');
      adminWallet = await prisma.adminWallet.create({
        data: {
          balance: 10000, // Test balance
          totalDeposited: 10000,
          totalPaidOut: 0,
        },
      });
      console.log('✅ Created admin wallet with ₹10,000 balance\n');
    } else {
      console.log(`📊 Current admin wallet balance: ₹${adminWallet.balance}\n`);
      
      if (adminWallet.balance < 10000) {
        console.log('💰 Adding balance to admin wallet for testing...\n');
        const additionalBalance = 10000 - adminWallet.balance;
        adminWallet = await prisma.adminWallet.update({
          where: { id: adminWallet.id },
          data: {
            balance: 10000,
            totalDeposited: adminWallet.totalDeposited + additionalBalance,
          },
        });
        console.log(`✅ Updated admin wallet balance to ₹${adminWallet.balance}\n`);
      } else {
        console.log('✅ Admin wallet already has sufficient balance\n');
      }
    }

    console.log('📋 Admin Wallet Status:');
    console.log(`   Balance: ₹${adminWallet.balance}`);
    console.log(`   Total Deposited: ₹${adminWallet.totalDeposited}`);
    console.log(`   Total Paid Out: ₹${adminWallet.totalPaidOut}\n`);

    console.log('💡 Admin wallet is now ready for processing payouts!\n');

  } catch (error: any) {
    console.error('❌ Error setting up admin wallet:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
setupAdminWallet();




