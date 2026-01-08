import { prisma } from '../lib/prisma';
import { PartnerCategory } from '@prisma/client';

export interface RestaurantInput {
  name: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  latitude: number;
  longitude: number;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  metadata?: Record<string, any>;
}

export interface RestaurantFilters {
  partnerId?: string;
  isActive?: boolean;
}

export const restaurantService = {
  /**
   * Create a restaurant for a food delivery partner
   */
  async createRestaurant(partnerId: string, data: RestaurantInput) {
    // Verify partner exists and is a food delivery partner
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, category: true },
    });

    if (!partner) {
      throw new Error('Partner not found');
    }

    if (partner.category !== PartnerCategory.FOOD_DELIVERY) {
      throw new Error('Only food delivery partners can create restaurants');
    }

    return await prisma.restaurant.create({
      data: {
        partnerId,
        ...data,
      },
      include: {
        partner: {
          select: {
            id: true,
            companyName: true,
            category: true,
          },
        },
      },
    });
  },

  /**
   * Get restaurants with optional filters
   */
  async getRestaurants(filters: RestaurantFilters = {}) {
    const where: any = {};

    if (filters.partnerId) {
      where.partnerId = filters.partnerId;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    return await prisma.restaurant.findMany({
      where,
      include: {
        partner: {
          select: {
            id: true,
            companyName: true,
            category: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  },

  /**
   * Get restaurants available for pickup selection
   */
  async getAvailableRestaurants(partnerId?: string) {
    const where: any = {
      isActive: true,
    };

    // If partnerId is provided, only show their own restaurants
    if (partnerId) {
      where.partnerId = partnerId;
    }

    return await prisma.restaurant.findMany({
      where,
      include: {
        partner: {
          select: {
            id: true,
            companyName: true,
            category: true,
            user: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  },

  /**
   * Get a single restaurant by ID
   */
  async getRestaurantById(restaurantId: string) {
    return await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        partner: {
          select: {
            id: true,
            companyName: true,
            category: true,
          },
        },
      },
    });
  },

  /**
   * Update a restaurant
   */
  async updateRestaurant(restaurantId: string, partnerId: string, data: Partial<RestaurantInput> & { isActive?: boolean }) {
    // Verify restaurant belongs to partner
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { partnerId: true },
    });

    if (!restaurant) {
      throw new Error('Restaurant not found');
    }

    if (restaurant.partnerId !== partnerId) {
      throw new Error('Unauthorized: Restaurant does not belong to this partner');
    }

    return await prisma.restaurant.update({
      where: { id: restaurantId },
      data,
      include: {
        partner: {
          select: {
            id: true,
            companyName: true,
            category: true,
          },
        },
      },
    });
  },

  /**
   * Delete a restaurant (soft delete by setting isActive to false)
   */
  async deleteRestaurant(restaurantId: string, partnerId: string) {
    // Verify restaurant belongs to partner
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { partnerId: true },
    });

    if (!restaurant) {
      throw new Error('Restaurant not found');
    }

    if (restaurant.partnerId !== partnerId) {
      throw new Error('Unauthorized: Restaurant does not belong to this partner');
    }

    // Check if restaurant is used in any orders
    const orderCount = await prisma.order.count({
      where: {
        pickupRestaurantId: restaurantId,
      },
    });

    if (orderCount > 0) {
      // Soft delete
      return await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { isActive: false },
      });
    } else {
      // Hard delete if no orders reference it
      return await prisma.restaurant.delete({
        where: { id: restaurantId },
      });
    }
  },

  /**
   * Get restaurants owned by a specific partner
   */
  async getPartnerRestaurants(partnerId: string) {
    return await prisma.restaurant.findMany({
      where: {
        partnerId,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  },
};


















