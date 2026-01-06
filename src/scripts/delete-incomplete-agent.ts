import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function deleteIncompleteAgent(email: string) {
  try {
    console.log(`\n🔍 Checking for user with email: ${email}\n`);

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        agent: true,
      },
    });

    if (!user) {
      console.log(`❌ User with email "${email}" not found.`);
      return;
    }

    console.log(`✅ Found user: ${user.name} (${user.email})`);
    console.log(`   Role: ${user.role}`);

    if (user.agent) {
      console.log(`\n⚠️  User has an agent record. Agent ID: ${user.agent.id}`);
      console.log('   This is a complete registration. Not deleting.');
      return;
    }

    console.log('\n❌ User exists but has NO agent record.');
    console.log('   This is an incomplete registration.');
    console.log('\n🗑️  Deleting incomplete user registration...\n');

    // Check for any orders associated with this user (via partner if they were a partner)
    // But since this is an AGENT role user without an agent record, there shouldn't be any
    // Still, we'll delete safely
    
    // Delete user (this will cascade delete any related records)
    await prisma.user.delete({
      where: { id: user.id },
    });

    console.log(`✅ Successfully deleted incomplete user: ${user.email}`);
    console.log('   The user can now register again properly.\n');
  } catch (error: any) {
    console.error('❌ Error deleting user:', error.message);
    if (error.code === 'P2003') {
      console.error('   Cannot delete: User has related records that prevent deletion.');
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: ts-node delete-incomplete-agent.ts <email>');
  process.exit(1);
}

deleteIncompleteAgent(email);

