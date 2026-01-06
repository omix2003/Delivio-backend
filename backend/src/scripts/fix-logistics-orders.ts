import { prisma } from '../lib/prisma';

/**
 * Script to fix orders that were created with multi-leg logistics flow
 * but don't have logisticsProviderId set
 */
async function fixLogisticsOrders() {
  console.log('🔍 Finding orders with originWarehouseId but missing logisticsProviderId...');

  // Find orders that have originWarehouseId (indicating multi-leg flow) but no logisticsProviderId
  const ordersToFix = await prisma.order.findMany({
    where: {
      originWarehouseId: { not: null },
      logisticsProviderId: null,
    },
    include: {
      originWarehouse: {
        include: {
          partner: {
            select: {
              id: true,
              category: true,
              companyName: true,
            },
          },
        },
      },
    },
  });

  console.log(`📦 Found ${ordersToFix.length} orders to fix`);

  if (ordersToFix.length === 0) {
    console.log('✅ No orders need fixing!');
    return;
  }

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const order of ordersToFix) {
    try {
      // Check if origin warehouse exists and has a partner
      if (!order.originWarehouse) {
        console.log(`⚠️  Order ${order.id}: Origin warehouse not found, skipping`);
        skipped++;
        continue;
      }

      if (!order.originWarehouse.partner) {
        console.log(`⚠️  Order ${order.id}: Origin warehouse has no partner, skipping`);
        skipped++;
        continue;
      }

      // Check if the partner is a LOGISTICS_PROVIDER
      if (order.originWarehouse.partner.category !== 'LOGISTICS_PROVIDER') {
        console.log(`⚠️  Order ${order.id}: Origin warehouse partner is not LOGISTICS_PROVIDER (${order.originWarehouse.partner.category}), skipping`);
        skipped++;
        continue;
      }

      const logisticsProviderId = order.originWarehouse.partner.id;

      // Update the order
      await prisma.order.update({
        where: { id: order.id },
        data: {
          logisticsProviderId,
          // Also set currentWarehouseId if not set
          currentWarehouseId: order.currentWarehouseId || order.originWarehouseId,
        },
      });

      console.log(`✅ Fixed order ${order.id}: Set logisticsProviderId = ${logisticsProviderId}`);
      fixed++;
    } catch (error: any) {
      console.error(`❌ Error fixing order ${order.id}:`, error.message);
      errors++;
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   ✅ Fixed: ${fixed}`);
  console.log(`   ⚠️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`\n🎉 Done!`);
}

// Run the script
fixLogisticsOrders()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });






















