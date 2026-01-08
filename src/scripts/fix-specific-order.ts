/**
 * Script to fix a specific order's dropWarehouseId based on currentWarehouseId
 * Usage: ts-node src/scripts/fix-specific-order.ts ORD027
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixSpecificOrder(orderId: string) {
  console.log(`Fixing order ${orderId}...\n`);

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        originWarehouseId: true,
        dropWarehouseId: true,
        currentWarehouseId: true,
        transitLegs: true,
      },
    });

    if (!order) {
      console.error(`Order ${orderId} not found`);
      process.exit(1);
    }

    console.log('Current order state:');
    console.log(`  - originWarehouseId: ${order.originWarehouseId}`);
    console.log(`  - currentWarehouseId: ${order.currentWarehouseId}`);
    console.log(`  - dropWarehouseId: ${order.dropWarehouseId}\n`);

    // If currentWarehouseId is set and different from origin, use it as destination
    if (order.currentWarehouseId && 
        order.currentWarehouseId !== order.originWarehouseId &&
        order.dropWarehouseId !== order.currentWarehouseId) {
      
      const destinationWarehouse = await prisma.warehouse.findUnique({
        where: { id: order.currentWarehouseId },
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
        },
      });

      if (destinationWarehouse) {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            dropWarehouseId: order.currentWarehouseId,
            dropLat: destinationWarehouse.latitude,
            dropLng: destinationWarehouse.longitude,
            dropAddressText: `${destinationWarehouse.name}, ${destinationWarehouse.address}`,
          },
        });

        console.log(`✅ Fixed order ${orderId}:`);
        console.log(`   - Old dropWarehouseId: ${order.dropWarehouseId}`);
        console.log(`   - New dropWarehouseId: ${order.currentWarehouseId}`);
        console.log(`   - Destination: ${destinationWarehouse.name}`);
        console.log(`   - Address: ${destinationWarehouse.address}\n`);
      } else {
        console.error(`Destination warehouse ${order.currentWarehouseId} not found`);
        process.exit(1);
      }
    } else {
      console.log('Order does not need fixing or currentWarehouseId is not set correctly');
      console.log(`  - dropWarehouseId === currentWarehouseId: ${order.dropWarehouseId === order.currentWarehouseId}`);
      console.log(`  - currentWarehouseId === originWarehouseId: ${order.currentWarehouseId === order.originWarehouseId}`);
    }

  } catch (error) {
    console.error('❌ Error fixing order:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get order ID from command line argument
const orderId = process.argv[2];

if (!orderId) {
  console.error('Usage: ts-node src/scripts/fix-specific-order.ts <ORDER_ID>');
  process.exit(1);
}

fixSpecificOrder(orderId)
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });















