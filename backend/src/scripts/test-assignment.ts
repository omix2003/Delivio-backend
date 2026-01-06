/**
 * Test script for Phase 5: Order Assignment Engine
 * 
 * This script tests:
 * 1. Agent location storage in Redis GEO
 * 2. Finding nearby agents
 * 3. Agent scoring
 * 4. Order assignment flow
 * 
 * Usage: ts-node src/scripts/test-assignment.ts
 */

import { prisma } from '../lib/prisma';
import { redisGeo } from '../lib/redis';
import { assignOrder, autoAssignOrder, findAndScoreAgents } from '../services/assignment.service';
import { generateId } from '../utils/id-generator.util';
import dotenv from 'dotenv';

dotenv.config();

// Test coordinates (New York area)
const TEST_PICKUP = {
  lat: 40.7128, // Times Square area
  lng: -74.0060,
};

const TEST_DROPOFF = {
  lat: 40.7589,
  lng: -73.9851,
};

async function setupTestData() {
  console.log('\n📋 Setting up test data...\n');

  // Get or create test agents
  const agents = await prisma.agent.findMany({
    where: {
      isApproved: true,
    },
    include: {
      user: true,
    },
    take: 5,
  });

  if (agents.length === 0) {
    console.log('❌ No approved agents found. Please run seed script first:');
    console.log('   npm run prisma:seed');
    return null;
  }

  console.log(`✅ Found ${agents.length} approved agents`);

  // Set agents to ONLINE and add locations to Redis
  const agentLocations = [
    { lat: 40.7128, lng: -74.0060, distance: 0 }, // Same as pickup
    { lat: 40.7150, lng: -74.0080, distance: 200 }, // 200m away
    { lat: 40.7200, lng: -74.0100, distance: 800 }, // 800m away
    { lat: 40.7300, lng: -74.0150, distance: 2000 }, // 2km away
    { lat: 40.7500, lng: -74.0200, distance: 4500 }, // 4.5km away
  ];

  console.log('\n📍 Adding agent locations to Redis...');
  for (let i = 0; i < Math.min(agents.length, agentLocations.length); i++) {
    const agent = agents[i];
    const location = agentLocations[i];

    // Update agent status to ONLINE
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        status: 'ONLINE',
        currentOrderId: null, // Ensure no current order
        lastOnlineAt: new Date(),
      },
    });

    // Add location to Redis
    await redisGeo.addAgentLocation(agent.id, location.lng, location.lat);
    console.log(
      `   ✅ Agent ${agent.user.name} (${agent.id.substring(0, 8)}) - ${location.distance}m from pickup`
    );
  }

  // Get test partner
  const partner = await prisma.partner.findFirst({
    where: {
      isActive: true,
    },
  });

  if (!partner) {
    console.log('❌ No active partner found. Please run seed script first.');
    return null;
  }

  console.log(`\n✅ Test partner: ${partner.companyName}`);

  return { agents: agents.slice(0, Math.min(agents.length, agentLocations.length)), partner };
}

async function testFindNearbyAgents() {
  console.log('\n🔍 Test 1: Finding nearby agents...\n');

  const nearbyAgents = await redisGeo.getNearbyAgents(
    TEST_PICKUP.lng,
    TEST_PICKUP.lat,
    5000, // 5km radius
    'm'
  );

  console.log(`Found ${nearbyAgents.length / 3} agents within 5km:`);
  
  // Parse results
  for (let i = 0; i < nearbyAgents.length; i += 3) {
    let agentId: string;
    let distance: number;
    
    const currentItem = nearbyAgents[i];
    if (Array.isArray(currentItem)) {
      agentId = currentItem[0] as string;
      distance = parseFloat(currentItem[1] as string);
    } else {
      agentId = currentItem as string;
      distance = parseFloat(nearbyAgents[i + 1] as string);
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: { select: { name: true } } },
    });

    console.log(
      `   - ${agent?.user.name || 'Unknown'} (${agentId.substring(0, 8)}): ${(distance / 1000).toFixed(2)}km away`
    );
  }

  return nearbyAgents.length > 0;
}

async function testAgentScoring() {
  console.log('\n📊 Test 2: Agent scoring algorithm...\n');

  const scoredAgents = await findAndScoreAgents(
    TEST_PICKUP.lat,
    TEST_PICKUP.lng,
    50.0, // $50 payout
    'NORMAL',
    5000
  );

  if (scoredAgents.length === 0) {
    console.log('❌ No agents found for scoring');
    return false;
  }

  console.log(`Scored ${scoredAgents.length} agents:\n`);
  for (const scored of scoredAgents.slice(0, 5)) {
    const agent = await prisma.agent.findUnique({
      where: { id: scored.agentId },
      include: { user: { select: { name: true } } },
    });

    console.log(`   ${agent?.user.name || 'Unknown'}:`);
    console.log(`      Distance: ${(scored.distance / 1000).toFixed(2)}km`);
    console.log(`      Score: ${scored.score.toFixed(2)}`);
    console.log(`      Acceptance Rate: ${scored.agent.acceptanceRate}%`);
    console.log(`      Rating: ${scored.agent.rating || 'N/A'}`);
    console.log(`      Total Orders: ${scored.agent.totalOrders}`);
    console.log(`      Current Order: ${scored.agent.currentOrderId ? 'Yes' : 'No'}`);
    console.log('');
  }

  return true;
}

async function testOrderAssignment() {
  console.log('\n📦 Test 3: Order assignment flow...\n');

  // Get test partner
  const partner = await prisma.partner.findFirst({
    where: { isActive: true },
  });

  if (!partner) {
    console.log('❌ No active partner found');
    return false;
  }

  // Create a test order
  console.log('Creating test order...');
  const orderId = await generateId('ORD');
  const order = await prisma.order.create({
    data: {
      id: orderId,
      partnerId: partner.id,
      pickupLat: TEST_PICKUP.lat,
      pickupLng: TEST_PICKUP.lng,
      dropLat: TEST_DROPOFF.lat,
      dropLng: TEST_DROPOFF.lng,
      payoutAmount: 50.0,
      priority: 'NORMAL',
      status: 'SEARCHING_AGENT',
    },
  });

  console.log(`✅ Created order: ${order.id}`);
  console.log(`   Pickup: ${TEST_PICKUP.lat}, ${TEST_PICKUP.lng}`);
  console.log(`   Payout: $${order.payoutAmount}`);

  // Test assignment
  console.log('\n🔍 Finding and offering order to agents...');
  const result = await assignOrder({
    orderId: order.id,
    pickupLat: order.pickupLat,
    pickupLng: order.pickupLng,
    payoutAmount: order.payoutAmount,
    priority: 'NORMAL',
    maxRadius: 5000,
    maxAgentsToOffer: 5,
    offerTimeout: 30,
  });

  if (result.success) {
    console.log(`✅ Assignment initiated successfully`);
    console.log(`   Agents offered: ${result.agentsOffered || 0}`);
    console.log(`   Assigned: ${result.assigned ? 'Yes' : 'No (waiting for acceptance)'}`);

    // Check order status
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        agent: {
          include: {
            user: {
              select: { name: true },
            },
          },
        },
      },
    });

    console.log(`\n   Order Status: ${updatedOrder?.status}`);
    if (updatedOrder?.agent) {
      console.log(`   Assigned Agent: ${updatedOrder.agent.user.name}`);
    }

    return true;
  } else {
    console.log(`❌ Assignment failed: ${result.error}`);
    return false;
  }
}

async function testAutoAssign() {
  console.log('\n⚡ Test 4: Auto-assignment (high priority)...\n');

  const partner = await prisma.partner.findFirst({
    where: { isActive: true },
  });

  if (!partner) {
    console.log('❌ No active partner found');
    return false;
  }

  // Create high priority order
  const orderId = await generateId('ORD');
  const order = await prisma.order.create({
    data: {
      id: orderId,
      partnerId: partner.id,
      pickupLat: TEST_PICKUP.lat,
      pickupLng: TEST_PICKUP.lng,
      dropLat: TEST_DROPOFF.lat,
      dropLng: TEST_DROPOFF.lng,
      payoutAmount: 75.0,
      priority: 'HIGH',
      status: 'SEARCHING_AGENT',
    },
  });

  console.log(`Created HIGH priority order: ${order.id}`);
  console.log(`   Payout: $${order.payoutAmount}`);

  const result = await autoAssignOrder(
    order.id,
    order.pickupLat,
    order.pickupLng,
    order.payoutAmount,
    'HIGH'
  );

  if (result.success && result.assigned) {
    console.log(`✅ Order auto-assigned to agent: ${result.agentId}`);

    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        agent: {
          include: {
            user: {
              select: { name: true },
            },
          },
        },
      },
    });

    console.log(`   Status: ${updatedOrder?.status}`);
    console.log(`   Agent: ${updatedOrder?.agent?.user.name || 'N/A'}`);
    return true;
  } else {
    console.log(`❌ Auto-assignment failed: ${result.error}`);
    return false;
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test orders...\n');

  // Delete test orders created in last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  
  const deleted = await prisma.order.deleteMany({
    where: {
      createdAt: {
        gte: fiveMinutesAgo,
      },
      status: {
        in: ['SEARCHING_AGENT', 'ASSIGNED'],
      },
    },
  });

  console.log(`✅ Deleted ${deleted.count} test orders`);
}

async function main() {
  console.log('🧪 Phase 5: Order Assignment Engine - Test Suite\n');
  console.log('='.repeat(60));

  try {
    // Setup
    const testData = await setupTestData();
    if (!testData) {
      console.log('\n❌ Test setup failed. Exiting.');
      process.exit(1);
    }

    // Run tests
    const results = {
      findAgents: await testFindNearbyAgents(),
      scoring: await testAgentScoring(),
      assignment: await testOrderAssignment(),
      autoAssign: await testAutoAssign(),
    };

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Results Summary:\n');
    console.log(`   ✅ Find Nearby Agents: ${results.findAgents ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Agent Scoring: ${results.scoring ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Order Assignment: ${results.assignment ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Auto-Assignment: ${results.autoAssign ? 'PASS' : 'FAIL'}`);

    const allPassed = Object.values(results).every((r) => r);
    console.log(`\n${allPassed ? '✅' : '❌'} Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

    // Cleanup
    await cleanup();

    process.exit(allPassed ? 0 : 1);
  } catch (error: any) {
    console.error('\n❌ Test suite failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

