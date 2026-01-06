import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function checkSpecificAgent(email: string) {
  try {
    console.log(`\n🔍 Checking for agent with email: ${email}\n`);

    // Check if user exists with this email
    const user = await prisma.user.findUnique({
      where: { email },
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
            documents: true,
          },
        },
      },
    });

    if (!user) {
      console.log(`❌ User with email "${email}" not found in database.`);
      console.log('\n📋 Checking for similar emails...\n');
      
      // Search for similar emails
      const allUsers = await prisma.user.findMany({
        where: {
          role: 'AGENT',
        },
        select: {
          email: true,
          name: true,
        },
      });

      if (allUsers.length > 0) {
        console.log('Found these agent emails:');
        allUsers.forEach(u => {
          console.log(`  - ${u.email} (${u.name})`);
        });
      }
      return;
    }

    console.log('✅ User found!');
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Phone: ${user.phone}`);
    console.log(`   Role: ${user.role}`);

    if (!user.agent) {
      console.log('\n❌ User exists but has NO agent record!');
      console.log('   This is an incomplete registration.');
      console.log('\n   Would you like to delete this user?');
      return { user, agent: null, shouldDelete: true };
    }

    console.log('\n✅ Agent record found!');
    console.log(`   Agent ID: ${user.agent.id}`);
    console.log(`   Vehicle Type: ${user.agent.vehicleType}`);
    console.log(`   Status: ${user.agent.status}`);
    console.log(`   Is Approved: ${user.agent.isApproved}`);
    console.log(`   Is Blocked: ${user.agent.isBlocked}`);
    console.log(`   City: ${user.agent.city || 'N/A'}`);
    console.log(`   State: ${user.agent.state || 'N/A'}`);
    console.log(`   Total Orders: ${user.agent.totalOrders}`);
    console.log(`   Completed Orders: ${user.agent.completedOrders}`);
    console.log(`   Active Orders: ${user.agent.orders.length}`);
    console.log(`   Documents: ${user.agent.documents.length}`);

    if (user.agent.orders.length > 0) {
      console.log(`\n⚠️  Warning: Agent has ${user.agent.orders.length} active order(s)`);
    }

    return { user, agent: user.agent, shouldDelete: false };
  } catch (error: any) {
    console.error('❌ Error checking agent:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: ts-node check-specific-agent.ts <email>');
  process.exit(1);
}

checkSpecificAgent(email);













