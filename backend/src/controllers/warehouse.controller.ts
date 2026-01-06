import { Request, Response, NextFunction } from 'express';
import { warehouseService } from '../services/warehouse.service';
import { createWarehouseSchema, updateWarehouseSchema } from '../utils/validation.schemas';
import { getPartnerId, getLogisticsProviderId } from '../utils/role.util';
import { prisma } from '../lib/prisma';

export const warehouseController = {
  /**
   * Create a warehouse
   * POST /api/warehouses
   */
  async createWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can create warehouses' });
      }

      const validatedData = createWarehouseSchema.parse(req.body);
      const warehouse = await warehouseService.createWarehouse(partnerId, validatedData);

      res.status(201).json(warehouse);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      next(error);
    }
  },

  /**
   * Get warehouses with filters
   * GET /api/warehouses
   */
  async getWarehouses(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = req.query.partnerId as string | undefined;
      const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;
      const category = req.query.category as 'CARRIER' | 'SELLER' | 'ALL' | undefined;

      const warehouses = await warehouseService.getWarehouses({
        partnerId,
        isActive,
        category,
      });

      res.json(warehouses);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get warehouses available for drop selection
   * GET /api/warehouses/available-for-drop
   * Query params:
   *   - showAllLogisticsProviders: if true, show all logistics provider warehouses (for multi-leg orders)
   */
  async getAvailableDropWarehouses(req: Request, res: Response, next: NextFunction) {
    try {
      const showAllLogisticsProviders = req.query.showAllLogisticsProviders === 'true';
      
      const partnerId = getPartnerId(req); // For Partner model
      const logisticsProviderId = getLogisticsProviderId(req); // For LogisticsProvider model
      
      // Determine if this is a logistics provider (either from Partner or LogisticsProvider model)
      let isLogisticsProvider = false;
      let ownerId: string | undefined;
      let partnerCategory: string | undefined;
      
      if (logisticsProviderId) {
        // User is from LogisticsProvider model
        isLogisticsProvider = true;
        ownerId = logisticsProviderId;
        partnerCategory = 'LOGISTICS_PROVIDER';
      } else if (partnerId) {
        // Get partner category
        const partner = await prisma.partner.findUnique({
          where: { id: partnerId },
          select: { category: true },
        });
        partnerCategory = partner?.category;
        
        if (partnerCategory === 'LOGISTICS_PROVIDER') {
          isLogisticsProvider = true;
          ownerId = partnerId;
        } else {
          // For seller partners (QUICK_COMMERCE, ECOMMERCE, LOCAL_STORE), use their partnerId
          ownerId = partnerId;
        }
      }
      
      const warehouses = await warehouseService.getAvailableDropWarehouses(
        ownerId || undefined, 
        partnerCategory,
        showAllLogisticsProviders
      );

      res.json(warehouses);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get a single warehouse
   * GET /api/warehouses/:id
   */
  async getWarehouseById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const warehouse = await warehouseService.getWarehouseById(id);

      if (!warehouse) {
        return res.status(404).json({ error: 'Warehouse not found' });
      }

      res.json(warehouse);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update a warehouse
   * PUT /api/warehouses/:id
   */
  async updateWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can update warehouses' });
      }

      const { id } = req.params;
      const validatedData = updateWarehouseSchema.parse(req.body);

      const warehouse = await warehouseService.updateWarehouse(id, partnerId, validatedData);

      res.json(warehouse);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      if (error.message === 'Warehouse not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Unauthorized')) {
        return res.status(403).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Delete a warehouse
   * DELETE /api/warehouses/:id
   */
  async deleteWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can delete warehouses' });
      }

      const { id } = req.params;
      await warehouseService.deleteWarehouse(id, partnerId);

      res.json({ message: 'Warehouse deleted successfully' });
    } catch (error: any) {
      if (error.message === 'Warehouse not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Unauthorized')) {
        return res.status(403).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Get warehouses owned by the current partner
   * GET /api/warehouses/my-warehouses
   */
  async getMyWarehouses(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can view their warehouses' });
      }

      const warehouses = await warehouseService.getPartnerWarehouses(partnerId);

      res.json(warehouses);
    } catch (error) {
      next(error);
    }
  },
};










