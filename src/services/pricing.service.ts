import { prisma } from '../lib/prisma';
import { PartnerCategory, SLAPriority } from '@prisma/client';

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface PricingCalculation {
  partnerPayment: number; // Total amount partner pays
  agentPayout: number; // Amount paid to agent
  adminCommission: number; // Platform commission
  distanceKm: number;
  baseFee: number;
  perKmFee: number;
  surgeMultiplier: number;
}

export interface PricingCalculationInput {
  partnerId: string;
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
  isSurge?: boolean; // Whether surge pricing applies
}

export const pricingService = {
  /**
   * Get pricing profile for a partner (uses partner's custom profile or category default)
   */
  async getPricingProfile(partnerId: string): Promise<{
    id: string;
    name: string;
    category: PartnerCategory;
    baseFee: number;
    perKmFee: number;
    surgePercent: number;
    agentSharePct: number;
  }> {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      include: {
        pricingProfile: true,
      },
    });

    if (!partner) {
      throw new Error('Partner not found');
    }

    // If partner has custom pricing profile, use it
    if (partner.pricingProfile) {
      return {
        id: partner.pricingProfile.id,
        name: partner.pricingProfile.name,
        category: partner.pricingProfile.category,
        baseFee: partner.pricingProfile.baseFee,
        perKmFee: partner.pricingProfile.perKmFee,
        surgePercent: partner.pricingProfile.surgePercent,
        agentSharePct: partner.pricingProfile.agentSharePct,
      };
    }

    // Otherwise, use default pricing profile for partner's category
    let defaultProfile = await prisma.pricingProfile.findUnique({
      where: { category: partner.category },
    });

    // If default profile doesn't exist, try to seed it automatically
    if (!defaultProfile) {
      console.warn(
        `⚠️  Pricing profile for category ${partner.category} not found. Attempting to seed default profiles...`
      );
      try {
        await this.seedDefaultPricingProfiles();
        // Try to find it again after seeding
        defaultProfile = await prisma.pricingProfile.findUnique({
          where: { category: partner.category },
        });
      } catch (seedError: any) {
        console.error(
          '[Pricing Service] Failed to seed default pricing profiles:',
          seedError
        );
      }
    }

    if (!defaultProfile) {
      throw new Error(
        `No pricing profile found for category ${partner.category}. Please ensure pricing profiles are seeded.`
      );
    }

    return {
      id: defaultProfile.id,
      name: defaultProfile.name,
      category: defaultProfile.category,
      baseFee: defaultProfile.baseFee,
      perKmFee: defaultProfile.perKmFee,
      surgePercent: defaultProfile.surgePercent,
      agentSharePct: defaultProfile.agentSharePct,
    };
  },

  /**
   * Calculate order pricing based on partner's pricing profile
   */
  async calculateOrderPricing(
    input: PricingCalculationInput
  ): Promise<PricingCalculation> {
    const profile = await this.getPricingProfile(input.partnerId);

    // Calculate distance
    const distanceKm = calculateDistanceKm(
      input.pickupLat,
      input.pickupLng,
      input.dropLat,
      input.dropLng
    );

    // Calculate base pricing
    const baseFee = profile.baseFee;
    const distanceFee = distanceKm * profile.perKmFee;

    // Apply surge if applicable
    const surgeMultiplier = input.isSurge
      ? 1 + profile.surgePercent / 100
      : 1;

    // Calculate partner payment (what partner pays)
    const partnerPayment =
      (baseFee + distanceFee) * surgeMultiplier;

    // Calculate agent payout (percentage of partner payment)
    const agentPayout = partnerPayment * (profile.agentSharePct / 100);

    // Calculate admin commission (remainder)
    const adminCommission = partnerPayment - agentPayout;

    return {
      partnerPayment: Math.round(partnerPayment * 100) / 100, // Round to 2 decimals
      agentPayout: Math.round(agentPayout * 100) / 100,
      adminCommission: Math.round(adminCommission * 100) / 100,
      distanceKm: Math.round(distanceKm * 100) / 100,
      baseFee,
      perKmFee: profile.perKmFee,
      surgeMultiplier,
    };
  },

  /**
   * Get SLA priority based on partner category
   */
  getSLAPriority(category: PartnerCategory): SLAPriority {
    switch (category) {
      case PartnerCategory.QUICK_COMMERCE:
      case PartnerCategory.FOOD_DELIVERY:
        return SLAPriority.EXPRESS;
      case PartnerCategory.ECOMMERCE:
      case PartnerCategory.LOCAL_STORE:
      case PartnerCategory.LOGISTICS_PROVIDER:
      default:
        return SLAPriority.STANDARD;
    }
  },

  /**
   * Seed default pricing profiles
   */
  async seedDefaultPricingProfiles(): Promise<void> {
    const profiles = [
      {
        name: 'QuickCommerceProfile',
        category: PartnerCategory.QUICK_COMMERCE,
        baseFee: 35,
        perKmFee: 4,
        surgePercent: 20,
        agentSharePct: 70,
      },
      {
        name: 'EcommerceProfile',
        category: PartnerCategory.ECOMMERCE,
        baseFee: 45,
        perKmFee: 6,
        surgePercent: 15,
        agentSharePct: 70,
      },
      {
        name: 'LocalStoreProfile',
        category: PartnerCategory.LOCAL_STORE,
        baseFee: 30,
        perKmFee: 5,
        surgePercent: 10,
        agentSharePct: 70,
      },
      {
        name: 'FoodDeliveryProfile',
        category: PartnerCategory.FOOD_DELIVERY,
        baseFee: 40,
        perKmFee: 5,
        surgePercent: 25,
        agentSharePct: 70,
      },
      {
        name: 'LogisticsProviderProfile',
        category: PartnerCategory.LOGISTICS_PROVIDER,
        baseFee: 40,
        perKmFee: 5,
        surgePercent: 15,
        agentSharePct: 70,
      },
    ];

    for (const profileData of profiles) {
      await prisma.pricingProfile.upsert({
        where: { category: profileData.category },
        update: profileData,
        create: profileData,
      });
    }

    console.log('✅ Seeded default pricing profiles');
  },
};








