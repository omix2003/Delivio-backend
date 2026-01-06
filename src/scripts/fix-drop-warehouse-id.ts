/**
 * Script to fix existing orders where dropWarehouseId was incorrectly set to originWarehouseId
 * This script extracts the correct destinationWarehouseId from transitLegs and updates the order
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function fixDropWarehouseIds() {
  console.log('Starting to fix dropWarehouseId for existing orders...\n');

  try {
    // Find orders that have:
    // 1. originWarehouseId set (multi-leg orders)
    // 2. dropWarehouseId === originWarehouseId (the bug)
    // 3. transitLegs with leg 2 containing destinationWarehouseId
    const ordersToFix = await prisma.order.findMany({
      where: {
        AND: [
          { originWarehouseId: { not: null } },
          { dropWarehouseId: { not: null } },
          { transitLegs: { not: Prisma.JsonNull } },
        ],
      },
      select: {
        id: true,
        originWarehouseId: true,
        dropWarehouseId: true,
        currentWarehouseId: true,
        transitLegs: true,
      },
    });

    console.log(`Found ${ordersToFix.length} orders to check...\n`);

    let fixedCount = 0;
    let skippedCount = 0;

    for (const order of ordersToFix) {
      // Check if dropWarehouseId equals originWarehouseId (the bug)
      // OR if dropWarehouseId doesn't match currentWarehouseId when order has moved
      const needsFix = order.dropWarehouseId === order.originWarehouseId ||
        (order.currentWarehouseId && 
         order.currentWarehouseId !== order.originWarehouseId && 
         order.dropWarehouseId !== order.currentWarehouseId);
      
      if (needsFix) {
        // Priority 1: If order has currentWarehouseId and it's different from origin, use that
        // (This handles cases where order has already moved to destination warehouse)
        let correctDestinationWarehouseId: string | null = null;
        
        if (order.currentWarehouseId && 
            order.currentWarehouseId !== order.originWarehouseId &&
            order.currentWarehouseId !== order.dropWarehouseId) {
          // Order has moved to a different warehouse - that's the destination
          correctDestinationWarehouseId = order.currentWarehouseId;
          console.log(`[Order ${order.id}] Using currentWarehouseId as destination: ${correctDestinationWarehouseId}`);
        } else {
          // Priority 2: Try to extract destinationWarehouseId from transitLegs
          const transitLegs = order.transitLegs as any;
          
          if (Array.isArray(transitLegs)) {
            // Find leg 2 which should have destinationWarehouseId
            const leg2 = transitLegs.find((leg: any) => leg.leg === 2 || leg.to === 'DESTINATION_WAREHOUSE');
            
            if (leg2 && leg2.destinationWarehouseId) {
              correctDestinationWarehouseId = leg2.destinationWarehouseId;
              console.log(`[Order ${order.id}] Using transitLegs[1].destinationWarehouseId: ${correctDestinationWarehouseId}`);
            }
          }
        }
        
        if (correctDestinationWarehouseId) {
            
            // Also get the warehouse to update coordinates
            const destinationWarehouse = await prisma.warehouse.findUnique({
              where: { id: correctDestinationWarehouseId },
              select: {
                id: true,
                name: true,
                address: true,
                latitude: true,
                longitude: true,
              },
            });

          if (destinationWarehouse) {
            // Update the order
            await prisma.order.update({
              where: { id: order.id },
              data: {
                dropWarehouseId: correctDestinationWarehouseId,
                dropLat: destinationWarehouse.latitude,
                dropLng: destinationWarehouse.longitude,
                dropAddressText: `${destinationWarehouse.name}, ${destinationWarehouse.address}`,
              },
            });

            console.log(`✅ Fixed order ${order.id}:`);
            console.log(`   - Old dropWarehouseId: ${order.dropWarehouseId}`);
            console.log(`   - New dropWarehouseId: ${correctDestinationWarehouseId}`);
            console.log(`   - Destination: ${destinationWarehouse.name}\n`);
            
            fixedCount++;
          } else {
            console.log(`⚠️  Skipped order ${order.id}: Destination warehouse ${correctDestinationWarehouseId} not found\n`);
            skippedCount++;
          }
        } else {
          console.log(`⚠️  Skipped order ${order.id}: Could not determine destination warehouse (no currentWarehouseId or transitLegs data)\n`);
          skippedCount++;
        }
      } else {
        // Order already has correct dropWarehouseId
        skippedCount++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total orders checked: ${ordersToFix.length}`);
    console.log(`Orders fixed: ${fixedCount}`);
    console.log(`Orders skipped: ${skippedCount}`);
    console.log('\n✅ Fix completed!');

  } catch (error) {
    console.error('❌ Error fixing orders:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
fixDropWarehouseIds()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed:', error);
    process.exit(1);
  });

