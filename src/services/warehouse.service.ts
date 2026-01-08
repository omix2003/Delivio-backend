import { prisma } from '../lib/prisma';
import { PartnerCategory } from '@prisma/client';

export interface WarehouseInput {
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

export interface WarehouseFilters {
  partnerId?: string;
  isActive?: boolean;
  category?: 'CARRIER' | 'SELLER' | 'ALL'; // CARRIER = LOGISTICS_PROVIDER warehouses, SELLER = other partner warehouses
}

export const warehouseService = {
  /**
   * Create a warehouse for a partner
   */
  async createWarehouse(partnerId: string, data: WarehouseInput) {
    // Verify partner exists
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, category: true },
    });

    if (!partner) {
      throw new Error('Partner not found');
    }

    // Food delivery partners should use restaurants, not warehouses
    if (partner.category === PartnerCategory.FOOD_DELIVERY) {
      throw new Error('Food delivery partners should use restaurants, not warehouses');
    }

    return await prisma.warehouse.create({
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
   * Get warehouses with optional filters
   */
  async getWarehouses(filters: WarehouseFilters = {}) {
    const where: any = {};

    if (filters.partnerId) {
      where.partnerId = filters.partnerId;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    // Filter by category (CARRIER = LOGISTICS_PROVIDER, SELLER = others)
    // Exclude FOOD_DELIVERY partners (they use restaurants, not warehouses)
    if (filters.category && filters.category !== 'ALL') {
      const partnerWhere: any = {};
      if (filters.category === 'CARRIER') {
        partnerWhere.category = PartnerCategory.LOGISTICS_PROVIDER;
      } else if (filters.category === 'SELLER') {
        partnerWhere.category = { 
          notIn: [PartnerCategory.LOGISTICS_PROVIDER, PartnerCategory.FOOD_DELIVERY]
        };
      }
      where.partner = partnerWhere;
    } else {
      // Always exclude FOOD_DELIVERY partners from warehouse queries
      where.partner = {
        category: { not: PartnerCategory.FOOD_DELIVERY }
      };
    }

    return await prisma.warehouse.findMany({
      where,
      include: {
        partner: {
          select: {
            id: true,
            companyName: true,
            category: true,
          },
        },
        logisticsProvider: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  },

  /**
   * Get warehouses available for drop/pickup selection
   * - LOGISTICS_PROVIDER partners: only see their own warehouses (unless showAllLogisticsProviders is true)
   * - Seller partners (QUICK_COMMERCE, ECOMMERCE, LOCAL_STORE): only see their own warehouses
   * - FOOD_DELIVERY partners: should use restaurants, not warehouses (excluded)
   * - showAllLogisticsProviders: if true, show all logistics provider warehouses (for multi-leg orders)
   */
  async getAvailableDropWarehouses(partnerId?: string, partnerCategory?: string, showAllLogisticsProviders?: boolean) {
    const where: any = {
      isActive: true,
    };

    // If showAllLogisticsProviders is true, show all logistics provider warehouses (for multi-leg orders)
    if (showAllLogisticsProviders) {
      where.OR = [
        { partner: { category: PartnerCategory.LOGISTICS_PROVIDER } },
        { logisticsProviderId: { not: null } },
      ];
      } else if (partnerId) {
      if (partnerCategory === 'LOGISTICS_PROVIDER') {
        // Logistics providers can have warehouses in both Partner and LogisticsProvider models
        // Only show their own warehouses
        where.OR = [
          { partnerId: partnerId },
          { logisticsProviderId: partnerId },
        ];
      } else if (partnerCategory === 'FOOD_DELIVERY') {
        // Food delivery partners should not see warehouses (they use restaurants)
        // Return empty array
        return [];
      } else if (partnerCategory === 'LOCAL_STORE') {
        // LOCAL_STORE partners should not see warehouses (they have a single shop address)
        // Return empty array
        return [];
      } else {
        // For seller partners (QUICK_COMMERCE, ECOMMERCE), only show their own warehouses
        where.partnerId = partnerId;
      }
    }

    return await prisma.warehouse.findMany({
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
        logisticsProvider: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
      orderBy: [
        // Bring logistics provider warehouses first
        { logisticsProviderId: 'desc' },
        { partner: { category: 'asc' } },
        { name: 'asc' },
      ],
    });
  },

  /**
   * Get a single warehouse by ID
   */
  async getWarehouseById(warehouseId: string) {
    return await prisma.warehouse.findUnique({
      where: { id: warehouseId },
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
   * Update a warehouse
   */
  async updateWarehouse(warehouseId: string, partnerId: string, data: Partial<WarehouseInput> & { isActive?: boolean }) {
    // Verify warehouse belongs to partner
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { partnerId: true },
    });

    if (!warehouse) {
      throw new Error('Warehouse not found');
    }

    if (warehouse.partnerId !== partnerId) {
      throw new Error('Unauthorized: Warehouse does not belong to this partner');
    }

    return await prisma.warehouse.update({
      where: { id: warehouseId },
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
   * Delete a warehouse (soft delete by setting isActive to false)
   */
  async deleteWarehouse(warehouseId: string, partnerId: string) {
    // Verify warehouse belongs to partner
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { partnerId: true },
    });

    if (!warehouse) {
      throw new Error('Warehouse not found');
    }

    if (warehouse.partnerId !== partnerId) {
      throw new Error('Unauthorized: Warehouse does not belong to this partner');
    }

    // Check if warehouse is used in any orders
    const orderCount = await prisma.order.count({
      where: {
        OR: [
          { pickupWarehouseId: warehouseId },
          { dropWarehouseId: warehouseId },
        ],
      },
    });

    if (orderCount > 0) {
      // Soft delete
      return await prisma.warehouse.update({
        where: { id: warehouseId },
        data: { isActive: false },
      });
    } else {
      // Hard delete if no orders reference it
      return await prisma.warehouse.delete({
        where: { id: warehouseId },
      });
    }
  },

  /**
   * Get warehouses owned by a specific partner
   */
  async getPartnerWarehouses(partnerId: string) {
    return await prisma.warehouse.findMany({
      where: {
        partnerId,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  },

  /**
   * Create a warehouse for a logistics provider
   */
  async createLogisticsProviderWarehouse(logisticsProviderId: string, data: WarehouseInput) {
    // Verify logistics provider exists
    const logisticsProvider = await prisma.logisticsProvider.findUnique({
      where: { id: logisticsProviderId },
      select: { id: true },
    });

    if (!logisticsProvider) {
      throw new Error('Logistics provider not found');
    }

    return await prisma.warehouse.create({
      data: {
        logisticsProviderId,
        ...data,
      },
      include: {
        logisticsProvider: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
    });
  },

  /**
   * Get warehouses owned by a specific logistics provider
   */
  async getLogisticsProviderWarehouses(logisticsProviderId: string, includeInactive: boolean = false) {
    return await prisma.warehouse.findMany({
      where: {
        logisticsProviderId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        logisticsProvider: {
          select: {
            id: true,
            companyName: true,
          },
        },
        _count: {
          select: {
            originOrders: true,
            currentOrders: true,
            pickupOrders: true,
            dropOrders: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  },

  /**
   * Update a warehouse for a logistics provider
   */
  async updateLogisticsProviderWarehouse(warehouseId: string, logisticsProviderId: string, data: Partial<WarehouseInput> & { isActive?: boolean }) {
    // Verify warehouse belongs to logistics provider
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { logisticsProviderId: true },
    });

    if (!warehouse) {
      throw new Error('Warehouse not found');
    }

    if (warehouse.logisticsProviderId !== logisticsProviderId) {
      throw new Error('Unauthorized: Warehouse does not belong to this logistics provider');
    }

    return await prisma.warehouse.update({
      where: { id: warehouseId },
      data,
      include: {
        logisticsProvider: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
    });
  },

  /**
   * Delete a warehouse for a logistics provider (soft delete by setting isActive to false)
   */
  async deleteLogisticsProviderWarehouse(warehouseId: string, logisticsProviderId: string) {
    // Verify warehouse belongs to logistics provider
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { logisticsProviderId: true },
    });

    if (!warehouse) {
      throw new Error('Warehouse not found');
    }

    if (warehouse.logisticsProviderId !== logisticsProviderId) {
      throw new Error('Unauthorized: Warehouse does not belong to this logistics provider');
    }

    // Check if warehouse is used in any orders
    const orderCount = await prisma.order.count({
      where: {
        OR: [
          { originWarehouseId: warehouseId },
          { currentWarehouseId: warehouseId },
          { pickupWarehouseId: warehouseId },
          { dropWarehouseId: warehouseId },
        ],
      },
    });

    if (orderCount > 0) {
      // Soft delete
      return await prisma.warehouse.update({
        where: { id: warehouseId },
        data: { isActive: false },
      });
    } else {
      // Hard delete if no orders reference it
      return await prisma.warehouse.delete({
        where: { id: warehouseId },
      });
    }
  },
};








