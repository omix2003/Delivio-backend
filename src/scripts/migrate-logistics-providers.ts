/**
 * Migration script to move logistics providers from Partner to LogisticsProvider
 * Run this BEFORE applying the new schema migration
 * 
 * Usage: npx ts-node src/scripts/migrate-logistics-providers.ts
 */

import { prisma } from '../lib/prisma';
import { generateId } from '../utils/id-generator.util';

async function migrateLogisticsProviders() {
  console.log('🚀 Starting logistics provider migration...');

  try {
    // Step 1: Find all LOGISTICS_PROVIDER partners
    const logisticsPartners = await prisma.partner.findMany({
      where: {
        category: 'LOGISTICS_PROVIDER',
      },
      include: {
        user: true,
        warehouses: true,
      },
    });

    console.log(`📦 Found ${logisticsPartners.length} logistics provider partners to migrate`);

    // Step 2: Create LogisticsProvider records
    for (const partner of logisticsPartners) {
      // Check if LogisticsProvider already exists
      const existing = await prisma.logisticsProvider.findUnique({
        where: { id: partner.id },
      });

      if (existing) {
        console.log(`⏭️  LogisticsProvider ${partner.id} already exists, skipping...`);
        continue;
      }

      // Create LogisticsProvider
      await prisma.logisticsProvider.create({
        data: {
          id: partner.id, // Use same ID for easier migration
          userId: partner.userId,
          companyName: partner.companyName,
          businessName: partner.businessName || partner.companyName,
          apiKey: partner.apiKey,
          webhookUrl: partner.webhookUrl,
          isActive: partner.isActive,
          address: partner.address,
          city: partner.city,
          pincode: partner.pincode,
          contactPhone: partner.contactPhone,
          billingEmail: partner.billingEmail,
          createdAt: partner.createdAt,
          updatedAt: partner.updatedAt,
        },
      });

      console.log(`✅ Created LogisticsProvider: ${partner.companyName} (${partner.id})`);

      // Step 3: Update warehouses to reference LogisticsProvider
      for (const warehouse of partner.warehouses) {
        await prisma.warehouse.update({
          where: { id: warehouse.id },
          data: {
            logisticsProviderId: partner.id,
            partnerId: null, // Remove partner reference
          },
        });
        console.log(`  📍 Updated warehouse: ${warehouse.name}`);
      }
    }

    // Step 4: Clear logisticsProviderId in Order table (temporarily)
    // This allows us to add the foreign key constraint
    const ordersWithLogistics = await prisma.order.findMany({
      where: {
        logisticsProviderId: { not: null },
      },
      select: {
        id: true,
        logisticsProviderId: true,
      },
    });

    console.log(`📋 Found ${ordersWithLogistics.length} orders with logisticsProviderId`);

    // Store the mapping for later restoration
    const orderLogisticsMapping: Record<string, string> = {};
    for (const order of ordersWithLogistics) {
      if (order.logisticsProviderId) {
        orderLogisticsMapping[order.id] = order.logisticsProviderId;
      }
    }

    // Temporarily set to null (we'll restore after schema is applied)
    await prisma.order.updateMany({
      where: {
        logisticsProviderId: { not: null },
      },
      data: {
        logisticsProviderId: null,
      },
    });

    console.log(`✅ Temporarily cleared logisticsProviderId from orders`);
    console.log(`💾 Mapping stored for ${Object.keys(orderLogisticsMapping).length} orders`);

    console.log('\n✅ Migration preparation complete!');
    console.log('📝 Next steps:');
    console.log('   1. Run: npx prisma db push');
    console.log('   2. Run: npx ts-node src/scripts/restore-order-logistics-providers.ts');
    console.log('   3. Generate Prisma client: npx prisma generate');

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateLogisticsProviders()
  .then(() => {
    console.log('✅ Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  });






















