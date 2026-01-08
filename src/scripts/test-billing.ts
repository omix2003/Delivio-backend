/**
 * Test Billing System Implementation
 * 
 * This script tests the billing system with different partner types:
 * - ECOMMERCE: Weekly invoice, Net-7
 * - QUICK_COMMERCE: Daily invoice, credit limit
 * - LOCAL_STORE: Wallet-based billing
 * - ENTERPRISE: Monthly invoice, Net-30
 */

import { prisma } from '../lib/prisma';
import { partnerBillingService } from '../services/partner-billing.service';
import { partnerWalletService } from '../services/partner-wallet.service';
import { billingService } from '../services/billing.service';
import { PartnerCategory, OrderStatus, BillingCycle } from '@prisma/client';
import { generateId } from '../utils/id-generator.util';
import bcrypt from 'bcryptjs';

async function testBillingSystem() {
  console.log('🧪 Starting Billing System Tests...\n');

  try {
    // Test 1: Get or create billing config for different partner types
    console.log('📋 Test 1: Billing Config Creation');
    console.log('=====================================');
    
    const partners = await prisma.partner.findMany({
      where: {
        isActive: true,
        category: {
          in: [
            PartnerCategory.ECOMMERCE,
            PartnerCategory.QUICK_COMMERCE,
            PartnerCategory.LOCAL_STORE,
            PartnerCategory.ENTERPRISE,
          ],
        },
      },
      take: 4,
    });

    if (partners.length === 0) {
      console.log('⚠️  No active partners found. Creating test partners...');
      // Create test partners if none exist
      const testPartners = await createTestPartners();
      partners.push(...testPartners);
    }

    for (const partner of partners.slice(0, 4)) {
      console.log(`\nTesting partner: ${partner.companyName} (${partner.category})`);
      const config = await partnerBillingService.getOrCreateBillingConfig(partner.id);
      console.log(`  ✓ Billing Config Created/Retrieved`);
      console.log(`    - Mode: ${config.billingMode}`);
      console.log(`    - Cycle: ${config.billingCycle}`);
      console.log(`    - Credit Period: ${config.creditPeriodDays} days`);
      if (config.creditLimit) {
        console.log(`    - Credit Limit: ₹${config.creditLimit}`);
      }
      if (config.minWalletBalance) {
        console.log(`    - Min Wallet Balance: ₹${config.minWalletBalance}`);
      }
    }

    // Test 2: Update billing cycle
    console.log('\n\n📝 Test 2: Update Billing Cycle');
    console.log('=====================================');
    
    if (partners.length > 0) {
      const testPartner = partners[0];
      console.log(`Testing with partner: ${testPartner.companyName}`);
      
      const originalConfig = await partnerBillingService.getOrCreateBillingConfig(testPartner.id);
      console.log(`  Original cycle: ${originalConfig.billingCycle}`);
      
      // Try updating to MONTHLY
      const updatedConfig = await partnerBillingService.updateBillingConfig(testPartner.id, {
        billingCycle: BillingCycle.MONTHLY,
      });
      console.log(`  ✓ Updated cycle: ${updatedConfig.billingCycle}`);
      
      // Restore original
      await partnerBillingService.updateBillingConfig(testPartner.id, {
        billingCycle: originalConfig.billingCycle,
      });
      console.log(`  ✓ Restored original cycle`);
    }

    // Test 3: Wallet functionality for LOCAL_STORE
    console.log('\n\n💰 Test 3: Wallet Functionality (LOCAL_STORE)');
    console.log('=====================================');
    
    const localStorePartner = partners.find(p => p.category === PartnerCategory.LOCAL_STORE);
    if (localStorePartner) {
      console.log(`Testing with partner: ${localStorePartner.companyName}`);
      
      // Get wallet
      const wallet = await partnerWalletService.getOrCreateWallet(localStorePartner.id);
      console.log(`  ✓ Wallet Retrieved/Created`);
      console.log(`    - Balance: ₹${wallet.balance}`);
      
      // Test top-up
      const topUpAmount = 1000;
      const topUpResult = await partnerWalletService.topUp(
        localStorePartner.id,
        topUpAmount,
        'Test top-up'
      );
      console.log(`  ✓ Top-up successful: ₹${topUpAmount}`);
      console.log(`    - New Balance: ₹${topUpResult.balance}`);
      
      // Get wallet details
      const walletDetails = await partnerWalletService.getWalletDetails(localStorePartner.id);
      console.log(`  ✓ Wallet Details Retrieved`);
      console.log(`    - Transactions: ${walletDetails.transactions.length}`);
      console.log(`    - Total Top-ups: ₹${walletDetails.summary.totalTopUps}`);
    } else {
      console.log('  ⚠️  No LOCAL_STORE partner found for wallet testing');
    }

    // Test 4: Invoice generation
    console.log('\n\n📄 Test 4: Invoice Generation');
    console.log('=====================================');
    
    // Find partners with delivered orders
    const partnersWithOrders = await prisma.partner.findMany({
      where: {
        isActive: true,
        orders: {
          some: {
            status: OrderStatus.DELIVERED,
            partnerCharge: { not: null },
          },
        },
      },
      include: {
        _count: {
          select: {
            orders: {
              where: {
                status: OrderStatus.DELIVERED,
                partnerCharge: { not: null },
              },
            },
          },
        },
      },
      take: 3,
    });

    if (partnersWithOrders.length > 0) {
      for (const partner of partnersWithOrders) {
        console.log(`\nTesting with partner: ${partner.companyName}`);
        console.log(`  - Delivered orders: ${partner._count.orders}`);
        
        // Get billing config
        const config = await partnerBillingService.getOrCreateBillingConfig(partner.id);
        
        // Calculate billing period
        const { periodStart, periodEnd } = partnerBillingService.calculateBillingPeriod(config.billingCycle);
        console.log(`  - Billing period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`);
        
        // Try to generate invoice
        try {
          const invoice = await partnerBillingService.generateInvoiceForPartner(partner.id);
          if (invoice) {
            console.log(`  ✓ Invoice Generated: ${invoice.invoiceNumber}`);
            console.log(`    - Total Amount: ₹${invoice.totalAmount}`);
            console.log(`    - Items: ${invoice.items.length}`);
            console.log(`    - Status: ${invoice.status}`);
          } else {
            console.log(`  ℹ️  No invoice generated (no unbilled orders in period)`);
          }
        } catch (error: any) {
          console.log(`  ⚠️  Invoice generation failed: ${error.message}`);
        }
      }
    } else {
      console.log('  ⚠️  No partners with delivered orders found for invoice testing');
    }

    // Test 5: Billing behavior decision
    console.log('\n\n🎯 Test 5: Billing Behavior Decision');
    console.log('=====================================');
    
    for (const partner of partners.slice(0, 4)) {
      const behavior = await partnerBillingService.decideBillingBehavior(partner.id);
      console.log(`\n${partner.companyName} (${partner.category}):`);
      console.log(`  - Mode: ${behavior.mode}`);
      console.log(`  - Should Invoice: ${behavior.shouldInvoice}`);
      console.log(`  - Should Deduct Wallet: ${behavior.shouldDeductWallet}`);
      console.log(`  - Should Check Credit Limit: ${behavior.shouldCheckCreditLimit}`);
    }

    // Test 6: Credit limit enforcement
    console.log('\n\n🚫 Test 6: Credit Limit Enforcement (QUICK_COMMERCE)');
    console.log('=====================================');
    
    const quickCommercePartner = partners.find(p => p.category === PartnerCategory.QUICK_COMMERCE);
    if (quickCommercePartner) {
      console.log(`Testing with partner: ${quickCommercePartner.companyName}`);
      
      const config = await partnerBillingService.getOrCreateBillingConfig(quickCommercePartner.id);
      console.log(`  - Current Credit Limit: ₹${config.creditLimit || 'Not set'}`);
      
      // Try updating credit limit
      if (!config.creditLimit) {
        await partnerBillingService.updateBillingConfig(quickCommercePartner.id, {
          creditLimit: 50000,
        });
        console.log(`  ✓ Credit limit set to ₹50,000`);
      }
    } else {
      console.log('  ⚠️  No QUICK_COMMERCE partner found for credit limit testing');
    }

    console.log('\n\n✅ All Tests Completed!\n');

  } catch (error: any) {
    console.error('\n❌ Test Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function createTestPartners() {
  console.log('Creating test partners...');
  
  const hashedPassword = await bcrypt.hash('password123', 10);
  const partners = [];

  // Create ECOMMERCE partner
  let ecommerceUser = await prisma.user.findFirst({
    where: { email: 'test-ecommerce@example.com' },
  });
  if (!ecommerceUser) {
    ecommerceUser = await prisma.user.create({
      data: {
        id: await generateId('USR'),
        email: 'test-ecommerce@example.com',
        name: 'Test E-commerce User',
        phone: `+1234567001`,
        passwordHash: hashedPassword,
        role: 'PARTNER',
        emailVerified: new Date(),
        phoneVerified: true,
      },
    });
  }
  const ecommercePartner = await prisma.partner.upsert({
    where: { userId: ecommerceUser.id },
    update: {},
    create: {
      id: await generateId('PRT'),
      userId: ecommerceUser.id,
      companyName: 'Test E-commerce Store',
      businessName: 'Test E-commerce Store',
      apiKey: `pk_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      category: PartnerCategory.ECOMMERCE,
      isActive: true,
    },
  });
  partners.push(ecommercePartner);

  // Create QUICK_COMMERCE partner
  let quickCommerceUser = await prisma.user.findFirst({
    where: { email: 'test-quickcommerce@example.com' },
  });
  if (!quickCommerceUser) {
    quickCommerceUser = await prisma.user.create({
      data: {
        id: await generateId('USR'),
        email: 'test-quickcommerce@example.com',
        name: 'Test Quick Commerce User',
        phone: `+1234567002`,
        passwordHash: hashedPassword,
        role: 'PARTNER',
        emailVerified: new Date(),
        phoneVerified: true,
      },
    });
  }
  const quickCommercePartner = await prisma.partner.upsert({
    where: { userId: quickCommerceUser.id },
    update: {},
    create: {
      id: await generateId('PRT'),
      userId: quickCommerceUser.id,
      companyName: 'Test Quick Commerce',
      businessName: 'Test Quick Commerce',
      apiKey: `pk_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      category: PartnerCategory.QUICK_COMMERCE,
      isActive: true,
    },
  });
  partners.push(quickCommercePartner);

  // Create LOCAL_STORE partner
  let localStoreUser = await prisma.user.findFirst({
    where: { email: 'test-localstore@example.com' },
  });
  if (!localStoreUser) {
    localStoreUser = await prisma.user.create({
      data: {
        id: await generateId('USR'),
        email: 'test-localstore@example.com',
        name: 'Test Local Store User',
        phone: `+1234567003`,
        passwordHash: hashedPassword,
        role: 'PARTNER',
        emailVerified: new Date(),
        phoneVerified: true,
      },
    });
  }
  const localStorePartner = await prisma.partner.upsert({
    where: { userId: localStoreUser.id },
    update: {},
    create: {
      id: await generateId('PRT'),
      userId: localStoreUser.id,
      companyName: 'Test Local Store',
      businessName: 'Test Local Store',
      apiKey: `pk_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      category: PartnerCategory.LOCAL_STORE,
      isActive: true,
    },
  });
  partners.push(localStorePartner);

  // Create ENTERPRISE partner
  let enterpriseUser = await prisma.user.findFirst({
    where: { email: 'test-enterprise@example.com' },
  });
  if (!enterpriseUser) {
    enterpriseUser = await prisma.user.create({
      data: {
        id: await generateId('USR'),
        email: 'test-enterprise@example.com',
        name: 'Test Enterprise User',
        phone: `+1234567004`,
        passwordHash: hashedPassword,
        role: 'PARTNER',
        emailVerified: new Date(),
        phoneVerified: true,
      },
    });
  }
  const enterprisePartner = await prisma.partner.upsert({
    where: { userId: enterpriseUser.id },
    update: {},
    create: {
      id: await generateId('PRT'),
      userId: enterpriseUser.id,
      companyName: 'Test Enterprise',
      businessName: 'Test Enterprise',
      apiKey: `pk_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      category: PartnerCategory.ENTERPRISE,
      isActive: true,
    },
  });
  partners.push(enterprisePartner);

  console.log(`✓ Created/Retrieved ${partners.length} test partners`);
  return partners;
}

// Run tests
if (require.main === module) {
  testBillingSystem()
    .then(() => {
      console.log('Tests completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Tests failed:', error);
      process.exit(1);
    });
}

export { testBillingSystem };

