import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function cleanupIncompleteUsers() {
  try {
    console.log('\n🔍 Finding incomplete user registrations...\n');

    const users = await prisma.user.findMany({
      include: {
        agent: {
          include: {
            orders: {
              where: {
                status: {
                  in: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'],
                },
              },
            },
          },
        },
        partner: true,
      },
    });

    const incompleteUsers: any[] = [];

    users.forEach(user => {
      if (user.role === 'AGENT' && !user.agent) {
        incompleteUsers.push({ user, issue: 'Missing agent record' });
      } else if (user.role === 'PARTNER' && !user.partner) {
        incompleteUsers.push({ user, issue: 'Missing partner record' });
      }
    });

    if (incompleteUsers.length === 0) {
      console.log('✅ No incomplete registrations found. All users are properly registered!');
      return;
    }

    console.log(`⚠️  Found ${incompleteUsers.length} incomplete registration(s):\n`);
    incompleteUsers.forEach(({ user, issue }) => {
      console.log(`   - ${user.email} (${user.role}): ${issue}`);
    });

    console.log('\n🗑️  Deleting incomplete user registrations...\n');

    for (const { user } of incompleteUsers) {
      try {
        // Check for active orders
        if (user.role === 'AGENT' && user.agent) {
          const activeOrders = user.agent.orders.length;
          if (activeOrders > 0) {
            console.log(`   ⚠️  Skipping ${user.email}: Has ${activeOrders} active order(s)`);
            continue;
          }
        }

        // Delete user (this will cascade delete related records)
        await prisma.user.delete({
          where: { id: user.id },
        });

        console.log(`   ✅ Deleted incomplete user: ${user.email}`);
      } catch (error: any) {
        console.error(`   ❌ Error deleting ${user.email}:`, error.message);
      }
    }

    console.log('\n✅ Cleanup complete!\n');
  } catch (error: any) {
    console.error('❌ Error during cleanup:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupIncompleteUsers();













