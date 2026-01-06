import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function listAgents() {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: 'AGENT',
      },
      include: {
        agent: true,
      },
    });

    console.log('\n📋 Agents found:\n');
    users.forEach((user) => {
      if (user.agent) {
        console.log(`  Email: ${user.email}`);
        console.log(`  Name: ${user.name}`);
        console.log(`  Agent ID: ${user.agent.id}`);
        console.log('  ---');
      }
    });
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

listAgents();













