/**
 * Restore logisticsProviderId in Order table after schema migration
 * Run this AFTER applying the new schema migration
 * 
 * Usage: npx ts-node src/scripts/restore-order-logistics-providers.ts
 */

import { prisma } from '../lib/prisma';

async function restoreOrderLogisticsProviders() {
  console.log('🚀 Restoring logisticsProviderId in orders...');

  try {
    // Find all orders that had logisticsProviderId before
    // We'll match them by checking if the logisticsProviderId exists in LogisticsProvider
    const allOrders = await prisma.order.findMany({
      where: {
        logisticsProviderId: null,
        // Only check orders that might have been logistics orders
        // You may need to adjust this query based on your data
      },
      select: {
        id: true,
        createdAt: true,
        partner: {
          select: {
            category: true,
          },
        },
      },
    });

    console.log(`📋 Found ${allOrders.length} orders to check`);

    // Since we cleared the IDs, we need to match them differently
    // Option 1: If you have a backup/export, restore from there
    // Option 2: Match by partner category and order creation time
    // Option 3: Manually update based on business logic

    // For now, we'll just log what needs to be done
    const logisticsPartnerOrders = allOrders.filter(
      (order) => order.partner?.category === 'LOGISTICS_PROVIDER'
    );

    console.log(`📦 Found ${logisticsPartnerOrders.length} orders from logistics provider partners`);

    if (logisticsPartnerOrders.length > 0) {
      console.log('\n⚠️  Manual restoration needed:');
      console.log('   You need to manually update orders to reference the correct LogisticsProvider');
      console.log('   based on your business logic or data backup.');
      console.log('\n   Example:');
      console.log('   await prisma.order.update({');
      console.log('     where: { id: "ORDER_ID" },');
      console.log('     data: { logisticsProviderId: "LGP_ID" }');
      console.log('   });');
    }

    console.log('\n✅ Restoration script completed');
    console.log('💡 If you have a data backup, restore logisticsProviderId values from there');

  } catch (error: any) {
    console.error('❌ Restoration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run restoration
restoreOrderLogisticsProviders()
  .then(() => {
    console.log('✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });






















