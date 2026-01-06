import { PrismaClient } from '@prisma/client';
import { redisGeo } from '../lib/redis';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function updateAgentLocation(email: string, latitude: number, longitude: number) {
  try {
    console.log(`\n📍 Updating location for agent: ${email}`);
    console.log(`   New coordinates: ${latitude}, ${longitude}\n`);

    // Find agent by email
    const user = await prisma.user.findUnique({
      where: { email },
      include: { agent: true },
    });

    if (!user || !user.agent) {
      console.error(`❌ Agent with email "${email}" not found`);
      return;
    }

    const agentId = user.agent.id;
    console.log(`✅ Found agent: ${user.name} (ID: ${agentId.substring(0, 8)}...)`);

    // Update location in Redis GEO
    console.log('   Updating Redis location...');
    const redisResult = await redisGeo.addAgentLocation(agentId, longitude, latitude);
    if (redisResult !== null) {
      console.log('   ✅ Redis location updated');
    } else {
      console.log('   ⚠️  Redis not available, skipping Redis update');
    }

    // Store in database for history
    console.log('   Adding location to database history...');
    await prisma.agentLocation.create({
      data: {
        agentId,
        latitude,
        longitude,
      },
    });
    console.log('   ✅ Database location history updated');

    // Update lastOnlineAt timestamp
    await prisma.agent.update({
      where: { id: agentId },
      data: { lastOnlineAt: new Date() },
    });

    console.log('\n✅ Location updated successfully!\n');
  } catch (error: any) {
    console.error('❌ Error updating agent location:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log('Usage: ts-node src/scripts/update-agent-location.ts <email> <latitude> <longitude>');
  console.log('Example: ts-node src/scripts/update-agent-location.ts AGNENT3@test.com 40.7589 -73.9851');
  process.exit(1);
}

const email = args[0];
const latitude = parseFloat(args[1]);
const longitude = parseFloat(args[2]);

if (isNaN(latitude) || isNaN(longitude)) {
  console.error('❌ Invalid coordinates. Latitude and longitude must be numbers.');
  process.exit(1);
}

updateAgentLocation(email, latitude, longitude)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });













