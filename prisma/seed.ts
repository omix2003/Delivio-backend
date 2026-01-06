import { PrismaClient, UserRole, VehicleType, AgentStatus, OrderStatus, PartnerCategory } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { pricingService } from '../src/services/pricing.service';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Seed default pricing profiles first (before clearing partners)
  console.log('💰 Seeding pricing profiles...');
  await pricingService.seedDefaultPricingProfiles();

  // Clear existing data (optional - comment out if you want to keep existing data)
  console.log('🗑️  Clearing existing data...');
  await prisma.order.deleteMany();
  await prisma.agentDocument.deleteMany();
  await prisma.agentLocation.deleteMany();
  await prisma.partnerDailyStats.deleteMany();
  await prisma.dailyStats.deleteMany();
  await prisma.appEvent.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.notificationToken.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.warehouse.deleteMany(); // Delete warehouses before partners
  await prisma.user.deleteMany();

  // Hash password for all users (default password: "password123")
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create Admin User
  console.log('👤 Creating admin user...');
  const adminUser = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: 'admin@delivery.com',
      phone: '+1234567890',
      passwordHash: hashedPassword,
      role: UserRole.ADMIN,
      emailVerified: new Date(),
      phoneVerified: true,
    },
  });
  console.log(`✅ Created admin: ${adminUser.email}`);

  // Create Agent Users
  console.log('🚴 Creating agent users...');
  const agents = [
    {
      name: 'John Rider',
      email: 'john@agent.com',
      phone: '+1234567891',
      vehicleType: VehicleType.BIKE,
      city: 'New York',
      state: 'NY',
      pincode: '10001',
      isApproved: true,
      status: AgentStatus.ONLINE,
      rating: 4.8,
      totalOrders: 150,
      completedOrders: 145,
      cancelledOrders: 5,
      acceptanceRate: 95.5,
    },
    {
      name: 'Sarah Driver',
      email: 'sarah@agent.com',
      phone: '+1234567892',
      vehicleType: VehicleType.CAR,
      city: 'Los Angeles',
      state: 'CA',
      pincode: '90001',
      isApproved: true,
      status: AgentStatus.ONLINE,
      rating: 4.9,
      totalOrders: 200,
      completedOrders: 198,
      cancelledOrders: 2,
      acceptanceRate: 98.0,
    },
    {
      name: 'Mike Scooter',
      email: 'mike@agent.com',
      phone: '+1234567893',
      vehicleType: VehicleType.SCOOTER,
      city: 'Chicago',
      state: 'IL',
      pincode: '60601',
      isApproved: true,
      status: AgentStatus.OFFLINE,
      rating: 4.5,
      totalOrders: 80,
      completedOrders: 75,
      cancelledOrders: 5,
      acceptanceRate: 90.0,
    },
    {
      name: 'Emma Bicycle',
      email: 'emma@agent.com',
      phone: '+1234567894',
      vehicleType: VehicleType.BICYCLE,
      city: 'San Francisco',
      state: 'CA',
      pincode: '94102',
      isApproved: false, // Not yet approved
      status: AgentStatus.OFFLINE,
      rating: 0,
      totalOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      acceptanceRate: 0,
    },
  ];

  type CreatedAgent = { user: Awaited<ReturnType<typeof prisma.user.create>>; agent: Awaited<ReturnType<typeof prisma.agent.create>> };
  const createdAgents: CreatedAgent[] = [];
  for (const agentData of agents) {
    const user = await prisma.user.create({
      data: {
        name: agentData.name,
        email: agentData.email,
        phone: agentData.phone,
        passwordHash: hashedPassword,
        role: UserRole.AGENT,
        emailVerified: new Date(),
        phoneVerified: true,
      },
    });

    const agent = await prisma.agent.create({
      data: {
        userId: user.id,
        vehicleType: agentData.vehicleType,
        status: agentData.status,
        rating: agentData.rating,
        totalOrders: agentData.totalOrders,
        completedOrders: agentData.completedOrders,
        cancelledOrders: agentData.cancelledOrders,
        acceptanceRate: agentData.acceptanceRate,
        city: agentData.city,
        state: agentData.state,
        pincode: agentData.pincode,
        isApproved: agentData.isApproved,
        lastOnlineAt: agentData.status === AgentStatus.ONLINE ? new Date() : null,
      },
    });

    createdAgents.push({ user, agent });
    console.log(`✅ Created agent: ${user.email} (${agentData.vehicleType})`);
  }

  // Create Partner Users
  console.log('🏢 Creating partner users...');
  const partners = [
    {
      name: 'Swiggy Integration',
      email: 'swiggy@partner.com',
      phone: '+1234567901',
      companyName: 'Swiggy',
      businessName: 'Swiggy',
      category: PartnerCategory.QUICK_COMMERCE,
      city: 'Mumbai',
      address: '123 Food Street',
      pincode: '400001',
      contactPhone: '+1234567901',
      billingEmail: 'billing@swiggy.com',
    },
    {
      name: 'Shopify Store',
      email: 'shopify@partner.com',
      phone: '+1234567902',
      companyName: 'Shopify Store',
      businessName: 'Shopify Store',
      category: PartnerCategory.ECOMMERCE,
      city: 'Delhi',
      address: '456 E-commerce Avenue',
      pincode: '110001',
      contactPhone: '+1234567902',
      billingEmail: 'billing@shopify.com',
    },
    {
      name: 'Local Kirana Store',
      email: 'kirana@partner.com',
      phone: '+1234567903',
      companyName: 'Local Kirana',
      businessName: 'Local Kirana Store',
      category: PartnerCategory.LOCAL_STORE,
      city: 'Bangalore',
      address: '789 Local Market',
      pincode: '560001',
      contactPhone: '+1234567903',
      billingEmail: 'billing@kirana.com',
    },
    {
      name: 'Express Logistics',
      email: 'logistics@partner.com',
      phone: '+1234567904',
      companyName: 'Express Logistics',
      businessName: 'Express Logistics Provider',
      category: PartnerCategory.LOGISTICS_PROVIDER,
      city: 'Mumbai',
      address: '100 Logistics Hub',
      pincode: '400001',
      contactPhone: '+1234567904',
      billingEmail: 'billing@logistics.com',
    },
  ];

  type CreatedPartner = { user: Awaited<ReturnType<typeof prisma.user.create>>; partner: Awaited<ReturnType<typeof prisma.partner.create>> };
  const createdPartners: CreatedPartner[] = [];
  for (const partnerData of partners) {
    const user = await prisma.user.create({
      data: {
        name: partnerData.name,
        email: partnerData.email,
        phone: partnerData.phone,
        passwordHash: hashedPassword,
        role: UserRole.PARTNER,
        emailVerified: new Date(),
        phoneVerified: true,
      },
    });

    // Generate API key (simple version - in production use crypto.randomBytes)
    const apiKey = `pk_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const partner = await prisma.partner.create({
      data: {
        userId: user.id,
        companyName: partnerData.companyName,
        businessName: partnerData.businessName,
        category: partnerData.category,
        apiKey: apiKey,
        webhookUrl: `https://${partnerData.companyName.toLowerCase().replace(/\s+/g, '')}.com/webhook`,
        isActive: true,
        city: partnerData.city,
        address: partnerData.address,
        pincode: partnerData.pincode,
        contactPhone: partnerData.contactPhone,
        billingEmail: partnerData.billingEmail,
      },
    });

    createdPartners.push({ user, partner });
    console.log(`✅ Created partner: ${user.email} (${partnerData.companyName})`);
    console.log(`   API Key: ${apiKey}`);
  }

  // Create some orders
  console.log('📦 Creating sample orders...');
  const orders = [
    {
      partner: createdPartners[0],
      agent: createdAgents[0],
      pickupLat: 40.7128,
      pickupLng: -74.0060,
      dropLat: 40.7589,
      dropLng: -73.9851,
      payoutAmount: 50.0,
      status: OrderStatus.DELIVERED,
      priority: 'NORMAL',
    },
    {
      partner: createdPartners[0],
      agent: null,
      pickupLat: 40.7505,
      pickupLng: -73.9934,
      dropLat: 40.7282,
      dropLng: -73.9942,
      payoutAmount: 75.0,
      status: OrderStatus.SEARCHING_AGENT,
      priority: 'HIGH',
    },
    {
      partner: createdPartners[1],
      agent: createdAgents[1],
      pickupLat: 34.0522,
      pickupLng: -118.2437,
      dropLat: 34.0689,
      dropLng: -118.4452,
      payoutAmount: 60.0,
      status: OrderStatus.OUT_FOR_DELIVERY,
      priority: 'NORMAL',
    },
  ];

  for (const orderData of orders) {
    const order = await prisma.order.create({
      data: {
        partnerId: orderData.partner.partner.id,
        agentId: orderData.agent?.agent.id,
        pickupLat: orderData.pickupLat,
        pickupLng: orderData.pickupLng,
        dropLat: orderData.dropLat,
        dropLng: orderData.dropLng,
        payoutAmount: orderData.payoutAmount,
        status: orderData.status,
        priority: orderData.priority,
        assignedAt: orderData.agent ? new Date() : null,
        pickedUpAt: orderData.status === OrderStatus.OUT_FOR_DELIVERY ? new Date() : null,
        deliveredAt: orderData.status === OrderStatus.DELIVERED ? new Date() : null,
      },
    });
    console.log(`✅ Created order: ${order.id} (${orderData.status})`);
  }

  // Create some agent documents
  console.log('📄 Creating agent documents...');
  for (const { agent } of createdAgents.slice(0, 3)) {
    await prisma.agentDocument.createMany({
      data: [
        {
          agentId: agent.id,
          documentType: 'LICENSE',
          fileName: 'driving_license.pdf',
          fileUrl: 'https://example.com/documents/license.pdf',
          verified: true,
        },
        {
          agentId: agent.id,
          documentType: 'VEHICLE_REG',
          fileName: 'vehicle_registration.pdf',
          fileUrl: 'https://example.com/documents/vehicle_reg.pdf',
          verified: true,
        },
        {
          agentId: agent.id,
          documentType: 'ID_PROOF',
          fileName: 'id_proof.pdf',
          fileUrl: 'https://example.com/documents/id_proof.pdf',
          verified: true,
        },
      ],
    });
  }
  console.log('✅ Created agent documents');

  // Create sample warehouses for logistics provider
  console.log('🏭 Creating sample warehouses...');
  const logisticsPartner = createdPartners.find(p => p.partner.category === PartnerCategory.LOGISTICS_PROVIDER);
  if (logisticsPartner) {
    await prisma.warehouse.createMany({
      data: [
        {
          partnerId: logisticsPartner.partner.id,
          name: 'Mumbai Central Warehouse',
          address: '100 Logistics Hub, Andheri East',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400069',
          country: 'India',
          latitude: 19.1136,
          longitude: 72.8697,
          contactName: 'Warehouse Manager',
          contactPhone: '+1234567904',
          isActive: true,
        },
        {
          partnerId: logisticsPartner.partner.id,
          name: 'Delhi North Warehouse',
          address: '200 Logistics Park, Noida',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          country: 'India',
          latitude: 28.5355,
          longitude: 77.3910,
          contactName: 'Warehouse Manager',
          contactPhone: '+1234567904',
          isActive: true,
        },
      ],
    });
    console.log('✅ Created 2 warehouses for logistics provider');
  }

  console.log('\n✨ Seed completed successfully!');
  console.log('\n📋 Summary:');
  console.log(`   - 1 Admin user (admin@delivery.com)`);
  console.log(`   - ${createdAgents.length} Agent users`);
  console.log(`   - ${createdPartners.length} Partner users`);
  console.log(`   - ${orders.length} Sample orders`);
  console.log('\n🔑 Default password for all users: password123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

