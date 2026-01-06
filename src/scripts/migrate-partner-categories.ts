/**
 * Migration script to add partner categories and pricing profiles
 * Run this after updating the Prisma schema
 * 
 * Usage: npx ts-node backend/src/scripts/migrate-partner-categories.ts
 */

import { PrismaClient, PartnerCategory } from '@prisma/client';
import { pricingService } from '../services/pricing.service';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting partner categories migration...');

  try {
    // Seed default pricing profiles
    console.log('💰 Seeding pricing profiles...');
    await pricingService.seedDefaultPricingProfiles();

    // Update existing partners to have proper fields
    // Note: category has a default value (LOCAL_STORE), so all partners should already have a category
    console.log('🔄 Updating existing partners...');
    const allPartners = await prisma.partner.findMany();
    
    let updatedCount = 0;
    for (const partner of allPartners) {
      // Ensure businessName is set
      if (!partner.businessName) {
        await prisma.partner.update({
          where: { id: partner.id },
          data: {
            businessName: partner.companyName,
          },
        });
        updatedCount++;
      }
    }

    console.log(`✅ Updated ${updatedCount} partners with businessName`);

    // Update existing orders to calculate pricing if missing
    console.log('📦 Updating existing orders with pricing...');
    
    // First, count total orders that need updating
    const totalOrdersToUpdate = await prisma.order.count({
      where: {
        OR: [
          { partnerPayment: null },
          { agentPayout: null },
          { adminCommission: null },
        ],
      },
    });

    console.log(`   Found ${totalOrdersToUpdate} orders that need pricing updates`);

    if (totalOrdersToUpdate === 0) {
      console.log('✅ No orders need pricing updates');
    } else {
      const BATCH_SIZE = 1000; // Process in batches to avoid memory issues
      let ordersUpdated = 0;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const ordersBatch = await prisma.order.findMany({
          where: {
            OR: [
              { partnerPayment: null },
              { agentPayout: null },
              { adminCommission: null },
            ],
          },
          include: {
            partner: true,
          },
          take: BATCH_SIZE,
          skip: offset,
          orderBy: { createdAt: 'asc' }, // Process oldest first
        });

        if (ordersBatch.length === 0) {
          hasMore = false;
          break;
        }

        console.log(`   Processing batch: ${offset + 1}-${offset + ordersBatch.length} of ${totalOrdersToUpdate}`);

        for (const order of ordersBatch) {
          try {
            // Validate partner exists
            if (!order.partner) {
              console.warn(`⚠️  Order ${order.id} has no partner, skipping`);
              continue;
            }

            // Calculate pricing for this order
            const pricing = await pricingService.calculateOrderPricing({
              partnerId: order.partnerId,
              pickupLat: order.pickupLat,
              pickupLng: order.pickupLng,
              dropLat: order.dropLat,
              dropLng: order.dropLng,
              isSurge: false,
            });

            // Get SLA priority
            const slaPriority = pricingService.getSLAPriority(order.partner.category);

            // Update order
            await prisma.order.update({
              where: { id: order.id },
              data: {
                partnerPayment: pricing.partnerPayment,
                agentPayout: pricing.agentPayout,
                adminCommission: pricing.adminCommission,
                partnerCategory: order.partner.category,
                distanceKm: pricing.distanceKm,
                slaPriority,
              },
            });

            ordersUpdated++;
          } catch (error: any) {
            console.warn(`⚠️  Failed to update order ${order.id}:`, error.message);
          }
        }

        offset += BATCH_SIZE;
        hasMore = ordersBatch.length === BATCH_SIZE; // Continue if we got a full batch

        // Small delay between batches to avoid overwhelming the database
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`✅ Updated ${ordersUpdated} out of ${totalOrdersToUpdate} orders with pricing information`);
      
      if (ordersUpdated < totalOrdersToUpdate) {
        console.warn(`⚠️  Warning: Only ${ordersUpdated} orders were updated out of ${totalOrdersToUpdate} that needed updates.`);
        console.warn(`   Some orders may have failed due to missing partner data or invalid coordinates.`);
      }
    }

    console.log('\n✨ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('❌ Migration script error:', error);
    process.exit(1);
  });
























