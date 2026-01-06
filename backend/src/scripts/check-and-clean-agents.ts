import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

interface AgentCheckResult {
  agentId: string;
  email: string;
  name: string;
  issues: string[];
  isValid: boolean;
}

async function checkAndCleanAgents() {
  try {
    console.log('\n🔍 Checking agent registration status...\n');

    // Get all agents with their users
    const agents = await prisma.agent.findMany({
      include: {
        user: true,
        orders: {
          where: {
            status: {
              in: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'],
            },
          },
        },
      },
    });

    if (agents.length === 0) {
      console.log('✅ No agents found in the database.');
      return;
    }

    const results: AgentCheckResult[] = [];
    const agentsToDelete: string[] = [];

    // Check each agent
    for (const agent of agents) {
      const issues: string[] = [];

      // Check if user exists
      if (!agent.user) {
        issues.push('❌ Missing user record');
      } else {
        // Check user role
        if (agent.user.role !== 'AGENT') {
          issues.push(`❌ User role is "${agent.user.role}" instead of "AGENT"`);
        }

        // Check required user fields
        if (!agent.user.email) {
          issues.push('❌ User email is missing');
        }
        if (!agent.user.name) {
          issues.push('❌ User name is missing');
        }
        if (!agent.user.phone) {
          issues.push('❌ User phone is missing');
        }
      }

      // Check required agent fields
      if (!agent.vehicleType) {
        issues.push('❌ Vehicle type is missing');
      }

      // Check if agent has active orders
      if (agent.orders.length > 0) {
        issues.push(`⚠️  Has ${agent.orders.length} active order(s) - will not delete`);
      }

      const isValid = issues.length === 0 || issues.some(issue => issue.includes('⚠️'));

      results.push({
        agentId: agent.id,
        email: agent.user?.email || 'N/A',
        name: agent.user?.name || 'N/A',
        issues,
        isValid,
      });

      // Mark for deletion if invalid and no active orders
      if (!isValid && agent.orders.length === 0) {
        agentsToDelete.push(agent.id);
      }
    }

    // Display results
    console.log('📊 Agent Registration Status:\n');
    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.name} (${result.email})`);
      console.log(`   Agent ID: ${result.agentId}`);
      if (result.issues.length === 0) {
        console.log('   ✅ Properly registered');
      } else {
        result.issues.forEach(issue => console.log(`   ${issue}`));
        if (result.isValid) {
          console.log('   ✅ Valid (has warnings but can be kept)');
        } else {
          console.log('   ❌ Invalid - will be deleted');
        }
      }
      console.log('');
    });

    // Delete invalid agents
    if (agentsToDelete.length > 0) {
      console.log(`\n🗑️  Deleting ${agentsToDelete.length} improperly registered agent(s)...\n`);

      for (const agentId of agentsToDelete) {
        const agent = await prisma.agent.findUnique({
          where: { id: agentId },
          include: {
            user: true,
            orders: true,
            documents: true,
            locationHistory: true,
            tickets: true,
          },
        });

        if (!agent) {
          console.log(`   ⚠️  Agent ${agentId} not found, skipping...`);
          continue;
        }

        try {
          // Delete in transaction to handle cascades properly
          await prisma.$transaction(async (tx) => {
            const userId = agent.user.id;

            // Delete related records first
            await tx.order.deleteMany({ where: { agentId } });
            await tx.agentLocation.deleteMany({ where: { agentId } });
            await tx.agentDocument.deleteMany({ where: { agentId } });
            await tx.supportTicket.deleteMany({ where: { agentId } });

            // Delete the user (this will cascade delete the agent)
            await tx.user.delete({ where: { id: userId } });
          });

          console.log(`   ✅ Deleted agent: ${agent.user?.email || agentId}`);
        } catch (error: any) {
          console.error(`   ❌ Error deleting agent ${agentId}:`, error.message);
        }
      }

      console.log('\n✅ Cleanup complete!\n');
    } else {
      console.log('\n✅ All agents are properly registered. No cleanup needed.\n');
    }
  } catch (error: any) {
    console.error('❌ Error checking agents:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAndCleanAgents();













