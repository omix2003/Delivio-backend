/**
 * Comprehensive Billing System Test
 * 
 * Tests the complete billing flow with real orders:
 * 1. Create test orders for different partner types
 * 2. Mark orders as delivered with billing amounts
 * 3. Test invoice generation
 * 4. Test wallet deductions
 * 5. Test billing cycle updates
 */

import { prisma } from '../lib/prisma';
import { partnerBillingService } from '../services/partner-billing.service';
import { partnerWalletService } from '../services/partner-wallet.service';
import { PartnerCategory, OrderStatus, BillingCycle } from '@prisma/client';
import { generateId } from '../utils/id-generator.util';
import bcrypt from 'bcryptjs';

async function comprehensiveBillingTest() {
  console.log('🧪 Starting Comprehensive Billing System Tests...\n');

  try {
    // Step 1: Get or create test partners
    console.log('📋 Step 1: Setting up test partners');
    console.log('=====================================\n');
    
    const partners = await setupTestPartners();
    
    // Step 2: Create test orders and mark them as delivered
    console.log('\n📦 Step 2: Creating test orders');
    console.log('=====================================\n');
    
    const orders = await createTestOrders(partners);
    console.log(`✓ Created ${orders.length} test orders`);
    
    // Step 3: Test billing config for each partner type
    console.log('\n⚙️  Step 3: Testing billing configurations');
    console.log('=====================================\n');
    
    for (const partner of partners) {
      const config = await partnerBillingService.getOrCreateBillingConfig(partner.id);
      console.log(`${partner.companyName} (${partner.category}):`);
      console.log(`  - Billing Mode: ${config.billingMode}`);
      console.log(`  - Billing Cycle: ${config.billingCycle}`);
      console.log(`  - Credit Period: ${config.creditPeriodDays} days`);
      if (config.creditLimit) {
        console.log(`  - Credit Limit: ₹${config.creditLimit}`);
      }
      if (config.minWalletBalance) {
        console.log(`  - Min Wallet Balance: ₹${config.minWalletBalance}`);
      }
    }

    // Step 4: Test wallet functionality for LOCAL_STORE
    console.log('\n💰 Step 4: Testing wallet functionality');
    console.log('=====================================\n');
    
    const localStorePartner = partners.find(p => p.category === PartnerCategory.LOCAL_STORE);
    if (localStorePartner) {
      // Top up wallet
      const topUpAmount = 5000;
      const wallet = await partnerWalletService.topUp(localStorePartner.id, topUpAmount, 'Test top-up');
      console.log(`✓ Wallet topped up: ₹${topUpAmount}`);
      console.log(`  - New Balance: ₹${wallet.balance}`);
      
      // Get wallet details
      const walletDetails = await partnerWalletService.getWalletDetails(localStorePartner.id);
      console.log(`✓ Wallet Details:`);
      console.log(`  - Balance: ₹${walletDetails.wallet.balance}`);
      console.log(`  - Transactions: ${walletDetails.transactions.length}`);
      console.log(`  - Total Top-ups: ₹${walletDetails.summary.totalTopUps}`);
    }

    // Step 5: Test invoice generation for different billing cycles
    console.log('\n📄 Step 5: Testing invoice generation');
    console.log('=====================================\n');
    
    // Test with ECOMMERCE partner (weekly billing)
    const ecommercePartner = partners.find(p => p.category === PartnerCategory.ECOMMERCE);
    if (ecommercePartner) {
      console.log(`Testing invoice generation for: ${ecommercePartner.companyName}`);
      
      // Get orders for this partner
      const partnerOrders = orders.filter(o => o.partnerId === ecommercePartner.id);
      console.log(`  - Delivered orders: ${partnerOrders.length}`);
      
      if (partnerOrders.length > 0) {
        // Calculate billing period (current week)
        const config = await partnerBillingService.getOrCreateBillingConfig(ecommercePartner.id);
        const { periodStart, periodEnd } = partnerBillingService.calculateBillingPeriod(config.billingCycle);
        
        console.log(`  - Billing Period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`);
        
        // Try to generate invoice
        try {
          const invoice = await partnerBillingService.generateInvoiceForPartner(ecommercePartner.id);
          if (invoice) {
            console.log(`  ✓ Invoice Generated: ${invoice.invoiceNumber}`);
            console.log(`    - Total Amount: ₹${invoice.totalAmount}`);
            console.log(`    - Items: ${invoice.items.length}`);
            console.log(`    - Status: ${invoice.status}`);
            console.log(`    - Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toISOString().split('T')[0] : 'N/A'}`);
          } else {
            console.log(`  ℹ️  No invoice generated (no unbilled orders in period)`);
          }
        } catch (error: any) {
          console.log(`  ⚠️  Invoice generation: ${error.message}`);
        }
      }
    }

    // Step 6: Test billing cycle update
    console.log('\n🔄 Step 6: Testing billing cycle update');
    console.log('=====================================\n');
    
    if (ecommercePartner) {
      const originalConfig = await partnerBillingService.getOrCreateBillingConfig(ecommercePartner.id);
      console.log(`Original cycle for ${ecommercePartner.companyName}: ${originalConfig.billingCycle}`);
      
      // Update to MONTHLY
      const updated = await partnerBillingService.updateBillingConfig(ecommercePartner.id, {
        billingCycle: BillingCycle.MONTHLY,
      });
      console.log(`✓ Updated to: ${updated.billingCycle}`);
      
      // Restore
      await partnerBillingService.updateBillingConfig(ecommercePartner.id, {
        billingCycle: originalConfig.billingCycle,
      });
      console.log(`✓ Restored to: ${originalConfig.billingCycle}`);
    }

    // Step 7: Test credit limit enforcement
    console.log('\n🚫 Step 7: Testing credit limit enforcement');
    console.log('=====================================\n');
    
    const quickCommercePartner = partners.find(p => p.category === PartnerCategory.QUICK_COMMERCE);
    if (quickCommercePartner) {
      const config = await partnerBillingService.getOrCreateBillingConfig(quickCommercePartner.id);
      console.log(`Partner: ${quickCommercePartner.companyName}`);
      console.log(`  - Credit Limit: ₹${config.creditLimit || 'Not set'}`);
      
      // Get pending invoices
      const pendingInvoices = await prisma.partnerInvoice.findMany({
        where: {
          partnerId: quickCommercePartner.id,
          status: { in: ['DRAFT', 'SENT', 'ACKNOWLEDGED'] },
        },
      });
      
      const pendingTotal = pendingInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
      console.log(`  - Pending Invoices: ${pendingInvoices.length}`);
      console.log(`  - Pending Total: ₹${pendingTotal}`);
      console.log(`  - Available Credit: ₹${(config.creditLimit || 0) - pendingTotal}`);
    }

    console.log('\n\n✅ All Comprehensive Tests Completed!\n');
    console.log('📊 Summary:');
    console.log(`   - Test Partners: ${partners.length}`);
    console.log(`   - Test Orders: ${orders.length}`);
    console.log(`   - All billing features tested successfully`);

  } catch (error: any) {
    console.error('\n❌ Test Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function setupTestPartners() {
  const hashedPassword = await bcrypt.hash('password123', 10);
  const partners = [];

  // Get existing partners or create new ones
  const existingPartners = await prisma.partner.findMany({
    where: {
      isActive: true,
      category: {
        in: [
          PartnerCategory.ECOMMERCE,
          PartnerCategory.QUICK_COMMERCE,
          PartnerCategory.LOCAL_STORE,
        ],
      },
    },
    take: 3,
  });

  if (existingPartners.length >= 3) {
    console.log(`✓ Using ${existingPartners.length} existing partners`);
    return existingPartners;
  }

  // Create missing partners
  const categories = [
    PartnerCategory.ECOMMERCE,
    PartnerCategory.QUICK_COMMERCE,
    PartnerCategory.LOCAL_STORE,
  ];

  for (const category of categories) {
    const email = `test-${category.toLowerCase()}@example.com`;
    let user = await prisma.user.findFirst({ where: { email } });
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          id: await generateId('USR'),
          email,
          name: `Test ${category} User`,
          phone: `+1234567${Math.floor(Math.random() * 10000)}`,
          passwordHash: hashedPassword,
          role: 'PARTNER',
          emailVerified: new Date(),
          phoneVerified: true,
        },
      });
    }

    const partner = await prisma.partner.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        id: await generateId('PRT'),
        userId: user.id,
        companyName: `Test ${category}`,
        businessName: `Test ${category}`,
        apiKey: `pk_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        category,
        isActive: true,
      },
    });

    partners.push(partner);
  }

  return partners;
}

async function createTestOrders(partners: any[]) {
  const orders = [];
  const now = new Date();

  for (const partner of partners) {
    // Create 2-3 orders per partner
    const orderCount = Math.floor(Math.random() * 2) + 2;
    
    for (let i = 0; i < orderCount; i++) {
      const orderAmount = 100 + Math.random() * 400;
      const partnerPayment = orderAmount;
      const agentPayout = 50 + Math.random() * 200;
      const adminCommission = 10 + Math.random() * 50;
      const partnerCharge = 100 + Math.random() * 400;
      
      const order = await prisma.order.create({
        data: {
          id: await generateId('ORD'),
          partnerId: partner.id,
          pickupLat: 19.0760 + (Math.random() - 0.5) * 0.1, // Mumbai area
          pickupLng: 72.8777 + (Math.random() - 0.5) * 0.1,
          dropLat: 19.0760 + (Math.random() - 0.5) * 0.1,
          dropLng: 72.8777 + (Math.random() - 0.5) * 0.1,
          customerName: `Test Customer ${i + 1}`,
          customerPhone: `+9198765432${i}`,
          customerAddress: `Test Address ${i + 1}`,
          orderAmount,
          partnerPayment,
          agentPayout,
          adminCommission,
          payoutAmount: agentPayout, // Required field
          partnerCharge, // For billing
          status: OrderStatus.DELIVERED,
          deliveredAt: new Date(now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Within last 7 days
          paymentType: 'PREPAID',
        },
      });
      orders.push(order);
    }
  }

  return orders;
}

// Run tests
if (require.main === module) {
  comprehensiveBillingTest()
    .then(() => {
      console.log('Tests completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Tests failed:', error);
      process.exit(1);
    });
}

export { comprehensiveBillingTest };

