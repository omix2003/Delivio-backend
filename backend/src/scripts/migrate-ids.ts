/**
 * Migration Script: Convert CUID IDs to Human-Readable Format
 * 
 * This script converts existing CUID-based IDs to the new format:
 * - ADN### for Admin users
 * - AGT### for Agents
 * - PRT### for Partners
 * - USR### for regular Users
 * - ORD### for Orders
 * 
 * IMPORTANT: Backup your database before running this script!
 * 
 * Usage: ts-node src/scripts/migrate-ids.ts
 */

import { PrismaClient } from '@prisma/client';
import { generateId } from '../utils/id-generator.util';

const prisma = new PrismaClient();

interface IdMapping {
  oldId: string;
  newId: string;
}

async function migrateIds() {
  console.log('🔄 Starting ID migration...\n');
  console.log('⚠️  WARNING: This will modify all IDs in your database!');
  console.log('⚠️  Make sure you have a backup before proceeding.\n');

  try {
    // Step 1: Migrate Users (must be first as other tables reference them)
    console.log('📝 Step 1: Migrating Users...');
    const users = await prisma.user.findMany({
      include: {
        agent: true,
        partner: true,
      },
    });

    const userMappings: IdMapping[] = [];
    let adminCount = 0;
    let agentCount = 0;
    let partnerCount = 0;
    let userCount = 0;

    for (const user of users) {
      // Skip if already in new format
      if (user.id.match(/^(ADN|AGT|PRT|USR)\d+$/)) {
        console.log(`   ⏭️  User ${user.id} already in new format, skipping`);
        continue;
      }

      let prefix: 'ADN' | 'AGT' | 'PRT' | 'USR';
      if (user.role === 'ADMIN') {
        prefix = 'ADN';
        adminCount++;
      } else if (user.agent) {
        prefix = 'AGT';
        agentCount++;
      } else if (user.partner) {
        prefix = 'PRT';
        partnerCount++;
      } else {
        prefix = 'USR';
        userCount++;
      }

      const newId = await generateId(prefix);
      userMappings.push({ oldId: user.id, newId });
      console.log(`   ✅ User: ${user.email} -> ${newId}`);
    }

    console.log(`\n   Summary: ${adminCount} admins, ${agentCount} agents, ${partnerCount} partners, ${userCount} users\n`);

    // Step 2: Migrate Agents
    console.log('📝 Step 2: Migrating Agents...');
    const agents = await prisma.agent.findMany();
    const agentMappings: IdMapping[] = [];

    for (const agent of agents) {
      // Skip if already in new format
      if (agent.id.match(/^AGT\d+$/)) {
        console.log(`   ⏭️  Agent ${agent.id} already in new format, skipping`);
        continue;
      }

      const newId = await generateId('AGT');
      agentMappings.push({ oldId: agent.id, newId });
      console.log(`   ✅ Agent: ${agent.id.substring(0, 8)}... -> ${newId}`);
    }

    // Step 3: Migrate Partners
    console.log('\n📝 Step 3: Migrating Partners...');
    const partners = await prisma.partner.findMany();
    const partnerMappings: IdMapping[] = [];

    for (const partner of partners) {
      // Skip if already in new format
      if (partner.id.match(/^PRT\d+$/)) {
        console.log(`   ⏭️  Partner ${partner.id} already in new format, skipping`);
        continue;
      }

      const newId = await generateId('PRT');
      partnerMappings.push({ oldId: partner.id, newId });
      console.log(`   ✅ Partner: ${partner.companyName} -> ${newId}`);
    }

    // Step 4: Migrate Orders
    console.log('\n📝 Step 4: Migrating Orders...');
    const orders = await prisma.order.findMany();
    const orderMappings: IdMapping[] = [];

    for (const order of orders) {
      // Skip if already in new format
      if (order.id.match(/^ORD\d+$/)) {
        console.log(`   ⏭️  Order ${order.id} already in new format, skipping`);
        continue;
      }

      const newId = await generateId('ORD');
      orderMappings.push({ oldId: order.id, newId });
      console.log(`   ✅ Order: ${order.id.substring(0, 8)}... -> ${newId}`);
    }

    // Step 5: Apply migrations using raw SQL to handle foreign keys
    console.log('\n🔄 Step 5: Applying ID changes to database...');
    console.log('   This may take a while...\n');

    // Disable foreign key checks temporarily (PostgreSQL)
    await prisma.$executeRawUnsafe('SET session_replication_role = replica;');

    // Update Users first (no dependencies)
    if (userMappings.length > 0) {
      console.log(`   Updating ${userMappings.length} users...`);
      for (const mapping of userMappings) {
        await prisma.$executeRawUnsafe(`
          UPDATE "User" SET id = $1 WHERE id = $2;
        `, mapping.newId, mapping.oldId);
      }
      
      // Update all foreign key references to users
      for (const mapping of userMappings) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Agent" SET "userId" = $1 WHERE "userId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "Partner" SET "userId" = $1 WHERE "userId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "NotificationToken" SET "userId" = $1 WHERE "userId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "Notification" SET "userId" = $1 WHERE "userId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "SupportTicket" SET "userId" = $1 WHERE "userId" = $2;
        `, mapping.newId, mapping.oldId);
      }
    }

    // Update Agents
    if (agentMappings.length > 0) {
      console.log(`   Updating ${agentMappings.length} agents...`);
      for (const mapping of agentMappings) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Agent" SET id = $1 WHERE id = $2;
        `, mapping.newId, mapping.oldId);
      }
      
      // Update all foreign key references to agents
      for (const mapping of agentMappings) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Order" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "Agent" SET "currentOrderId" = (
            SELECT "newId" FROM (VALUES ($1::text, $2::text)) AS t("newId", "oldId")
            WHERE "currentOrderId" = $2
          ) WHERE "currentOrderId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentDocument" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentLocation" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "SupportTicket" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentWallet" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "WalletPayout" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentRating" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentSchedule" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "PlatformRevenue" SET "agentId" = $1 WHERE "agentId" = $2;
        `, mapping.newId, mapping.oldId);
      }
    }

    // Update Partners
    if (partnerMappings.length > 0) {
      console.log(`   Updating ${partnerMappings.length} partners...`);
      for (const mapping of partnerMappings) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Partner" SET id = $1 WHERE id = $2;
        `, mapping.newId, mapping.oldId);
      }
      
      // Update all foreign key references to partners
      for (const mapping of partnerMappings) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Order" SET "partnerId" = $1 WHERE "partnerId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "SupportTicket" SET "partnerId" = $1 WHERE "partnerId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "PartnerDailyStats" SET "partnerId" = $1 WHERE "partnerId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "PartnerRevenue" SET "partnerId" = $1 WHERE "partnerId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "PlatformRevenue" SET "partnerId" = $1 WHERE "partnerId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentRating" SET "partnerId" = $1 WHERE "partnerId" = $2;
        `, mapping.newId, mapping.oldId);
      }
    }

    // Finally update Orders (has dependencies on Agent and Partner)
    if (orderMappings.length > 0) {
      console.log(`   Updating ${orderMappings.length} orders...`);
      for (const mapping of orderMappings) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Order" SET id = $1 WHERE id = $2;
        `, mapping.newId, mapping.oldId);
      }
      
      // Update all foreign key references to orders
      for (const mapping of orderMappings) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Agent" SET "currentOrderId" = $1 WHERE "currentOrderId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "SupportTicket" SET "orderId" = $1 WHERE "orderId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "AgentRating" SET "orderId" = $1 WHERE "orderId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "PartnerRevenue" SET "orderId" = $1 WHERE "orderId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "PlatformRevenue" SET "orderId" = $1 WHERE "orderId" = $2;
        `, mapping.newId, mapping.oldId);
        
        await prisma.$executeRawUnsafe(`
          UPDATE "WalletTransaction" SET "orderId" = $1 WHERE "orderId" = $2;
        `, mapping.newId, mapping.oldId);
      }
    }

    // Re-enable foreign key checks
    await prisma.$executeRawUnsafe('SET session_replication_role = DEFAULT;');

    console.log('\n✅ Migration completed successfully!');
    console.log(`   - ${userMappings.length} users migrated`);
    console.log(`   - ${agentMappings.length} agents migrated`);
    console.log(`   - ${partnerMappings.length} partners migrated`);
    console.log(`   - ${orderMappings.length} orders migrated\n`);

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error);
    console.error('   Please restore from backup if needed.');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
if (require.main === module) {
  migrateIds()
    .then(() => {
      console.log('✨ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Fatal error:', error);
      process.exit(1);
    });
}

export { migrateIds };
