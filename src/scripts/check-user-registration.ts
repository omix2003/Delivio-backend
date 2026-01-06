import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function checkUserRegistration(email?: string) {
  try {
    console.log('\n🔍 Checking user registration status...\n');

    if (email) {
      // Check specific user
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
            },
          },
          partner: true,
        },
      });

      if (!user) {
        console.log(`❌ User with email "${email}" not found.`);
        return;
      }

      console.log(`✅ User found: ${user.name} (${user.email})`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Phone: ${user.phone}`);
      console.log(`   Email Verified: ${user.emailVerified ? user.emailVerified.toISOString() : 'Not verified'}`);
      console.log(`   Phone Verified: ${user.phoneVerified}`);
      console.log(`   Created: ${user.createdAt.toISOString()}`);

      // Check role-specific data
      if (user.role === 'AGENT') {
        if (user.agent) {
          console.log(`\n✅ Agent record exists:`);
          console.log(`   Agent ID: ${user.agent.id}`);
          console.log(`   Status: ${user.agent.status}`);
          console.log(`   Vehicle Type: ${user.agent.vehicleType}`);
          console.log(`   Is Approved: ${user.agent.isApproved}`);
          console.log(`   Is Blocked: ${user.agent.isBlocked}`);
          console.log(`   City: ${user.agent.city || 'N/A'}`);
          console.log(`   State: ${user.agent.state || 'N/A'}`);
          console.log(`   Total Orders: ${user.agent.totalOrders}`);
          console.log(`   Completed Orders: ${user.agent.completedOrders}`);
          console.log(`   Active Orders: ${user.agent.orders.length}`);
        } else {
          console.log(`\n❌ User has AGENT role but NO agent record!`);
          console.log(`   This is an incomplete registration.`);
        }
      } else if (user.role === 'PARTNER') {
        if (user.partner) {
          console.log(`\n✅ Partner record exists:`);
          console.log(`   Partner ID: ${user.partner.id}`);
          console.log(`   Company Name: ${user.partner.companyName || 'N/A'}`);
          console.log(`   Is Active: ${user.partner.isActive}`);
        } else {
          console.log(`\n❌ User has PARTNER role but NO partner record!`);
          console.log(`   This is an incomplete registration.`);
        }
      } else if (user.role === 'ADMIN') {
        console.log(`\n✅ Admin user - no additional records needed.`);
      }

      // Check for issues
      const issues: string[] = [];
      if (!user.emailVerified) {
        issues.push('⚠️  Email not verified');
      }
      if (!user.phoneVerified) {
        issues.push('⚠️  Phone not verified');
      }
      if (user.role === 'AGENT' && !user.agent) {
        issues.push('❌ Missing agent record');
      }
      if (user.role === 'PARTNER' && !user.partner) {
        issues.push('❌ Missing partner record');
      }
      if (user.role === 'AGENT' && user.agent && !user.agent.isApproved) {
        issues.push('⚠️  Agent not approved');
      }

      if (issues.length > 0) {
        console.log(`\n📋 Issues found:`);
        issues.forEach(issue => console.log(`   ${issue}`));
      } else {
        console.log(`\n✅ User registration is complete and valid!`);
      }
    } else {
      // Check all users
      const users = await prisma.user.findMany({
        include: {
          agent: true,
          partner: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      console.log(`📊 Found ${users.length} users in database:\n`);

      const incompleteRegistrations: any[] = [];

      users.forEach((user, index) => {
        console.log(`${index + 1}. ${user.name} (${user.email})`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Created: ${user.createdAt.toISOString()}`);

        let isValid = true;

        if (user.role === 'AGENT' && !user.agent) {
          console.log(`   ❌ INCOMPLETE: Missing agent record`);
          incompleteRegistrations.push({ user, issue: 'Missing agent record' });
          isValid = false;
        } else if (user.role === 'AGENT' && user.agent) {
          console.log(`   ✅ Agent ID: ${user.agent.id}, Approved: ${user.agent.isApproved}`);
        }

        if (user.role === 'PARTNER' && !user.partner) {
          console.log(`   ❌ INCOMPLETE: Missing partner record`);
          incompleteRegistrations.push({ user, issue: 'Missing partner record' });
          isValid = false;
        } else if (user.role === 'PARTNER' && user.partner) {
          console.log(`   ✅ Partner ID: ${user.partner.id}, Active: ${user.partner.isActive}`);
        }

        if (isValid) {
          console.log(`   ✅ Registration complete`);
        }
        console.log('');
      });

      if (incompleteRegistrations.length > 0) {
        console.log(`\n⚠️  Found ${incompleteRegistrations.length} incomplete registration(s):\n`);
        incompleteRegistrations.forEach(({ user, issue }) => {
          console.log(`   - ${user.email} (${user.role}): ${issue}`);
        });
      } else {
        console.log(`\n✅ All users are properly registered!`);
      }
    }
  } catch (error: any) {
    console.error('❌ Error checking user registration:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];
checkUserRegistration(email);













