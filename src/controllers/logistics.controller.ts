import { Request, Response, NextFunction } from 'express';
import { logisticsService } from '../services/logistics.service';
import { 
  createLogisticsOrderSchema, 
  updateTransitStatusSchema, 
  markReadyForPickupSchema 
} from '../utils/validation.schemas';
import { getPartnerId } from '../utils/role.util';
import { OrderStatus } from '@prisma/client';

export const logisticsController = {
  /**
   * Create a logistics order
   * POST /api/logistics/orders
   */
  async createLogisticsOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getPartnerId(req);
      if (!logisticsProviderId) {
        return res.status(403).json({ error: 'Only partners can create logistics orders' });
      }

      const validatedData = createLogisticsOrderSchema.parse(req.body);
      
      const order = await logisticsService.createLogisticsOrder({
        ...validatedData,
        logisticsProviderId,
        expectedWarehouseArrival: validatedData.expectedWarehouseArrival 
          ? new Date(validatedData.expectedWarehouseArrival) 
          : undefined,
      });

      res.status(201).json(order);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      if (error.message.includes('not found') || error.message.includes('not a logistics provider')) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Unauthorized') || error.message.includes('does not belong')) {
        return res.status(403).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Get logistics orders
   * GET /api/logistics/orders
   */
  async getLogisticsOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getPartnerId(req);
      if (!logisticsProviderId) {
        return res.status(403).json({ error: 'Only partners can view logistics orders' });
      }

      const status = req.query.status 
        ? (Array.isArray(req.query.status) ? req.query.status : [req.query.status]) as OrderStatus[]
        : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      const result = await logisticsService.getLogisticsOrders(logisticsProviderId, {
        status,
        limit,
        offset,
      });

      res.json({ orders: result.orders, total: result.total, limit, offset });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get logistics order details
   * GET /api/logistics/orders/:id
   */
  async getLogisticsOrderDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getPartnerId(req);
      if (!logisticsProviderId) {
        return res.status(403).json({ error: 'Only partners can view logistics orders' });
      }

      const { id } = req.params;
      const order = await logisticsService.getLogisticsOrderDetails(id, logisticsProviderId);

      res.json(order);
    } catch (error: any) {
      if (error.message === 'Order not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Unauthorized')) {
        return res.status(403).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Update transit status
   * PUT /api/logistics/orders/:id/transit-status
   */
  async updateTransitStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getPartnerId(req);
      if (!logisticsProviderId) {
        return res.status(403).json({ error: 'Only partners can update transit status' });
      }

      const { id } = req.params;
      const validatedData = updateTransitStatusSchema.parse(req.body);

      const order = await logisticsService.updateTransitStatus({
        orderId: id,
        transitStatus: validatedData.transitStatus,
        currentWarehouseId: validatedData.currentWarehouseId || undefined, // Convert null/empty to undefined
        transitLegs: validatedData.transitLegs || undefined,
        expectedWarehouseArrival: validatedData.expectedWarehouseArrival 
          ? new Date(validatedData.expectedWarehouseArrival) 
          : undefined,
      }, logisticsProviderId);

      res.json(order);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      if (error.message === 'Order not found') {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Mark order as arrived at warehouse
   * PUT /api/logistics/orders/:id/arrive-at-warehouse
   */
  async markAtWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getPartnerId(req);
      if (!logisticsProviderId) {
        return res.status(403).json({ error: 'Only partners can update warehouse status' });
      }

      const { id } = req.params;
      const { warehouseId } = req.body;

      if (!warehouseId) {
        return res.status(400).json({ error: 'warehouseId is required' });
      }

      const order = await logisticsService.markAtWarehouse(id, warehouseId, logisticsProviderId);

      res.json(order);
    } catch (error: any) {
      if (error.message === 'Order not found' || error.message === 'Warehouse not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Unauthorized') || error.message.includes('does not belong')) {
        return res.status(403).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Mark order as ready for pickup
   * PUT /api/logistics/orders/:id/ready-for-pickup
   */
  async markReadyForPickup(req: Request, res: Response, next: NextFunction) {
    try {
      const logisticsProviderId = getPartnerId(req);
      if (!logisticsProviderId) {
        return res.status(403).json({ error: 'Only partners can mark orders ready for pickup' });
      }

      const { id } = req.params;
      const validatedData = markReadyForPickupSchema.parse(req.body);

      const order = await logisticsService.markReadyForPickup(
        id,
        validatedData.warehouseId,
        logisticsProviderId,
        validatedData.notes
      );

      res.json(order);
    } catch (error: any) {
      console.error('[Logistics Controller] markReadyForPickup error:', error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      if (error.message === 'Order not found' || error.message === 'Warehouse not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Unauthorized') || error.message.includes('does not belong')) {
        return res.status(403).json({ error: error.message });
      }
      if (error.message.includes('must be at warehouse') || 
          error.message.includes('missing delivery coordinates') ||
          error.message.includes('Failed to calculate pricing') ||
          error.message.includes('Failed to get pricing profile')) {
        return res.status(400).json({ error: error.message });
      }
      // Log full error for debugging
      console.error('[Logistics Controller] Full error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      next(error);
    }
  },
};
