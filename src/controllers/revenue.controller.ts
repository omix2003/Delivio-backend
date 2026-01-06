import { Request, Response, NextFunction } from 'express';
import { revenueService } from '../services/revenue.service';
import { getPartnerId } from '../utils/role.util';
import { AppError } from '../utils/errors.util';

export const revenueController = {
  /**
   * GET /api/partner/revenue/summary
   * Get partner revenue summary
   */
  async getPartnerRevenueSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        throw new AppError('Partner ID not found', 401);
      }

      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;

      const summary = await revenueService.getPartnerRevenueSummary(partnerId, start, end);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/partner/revenue
   * Get partner revenue records
   */
  async getPartnerRevenue(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        throw new AppError('Partner ID not found', 401);
      }

      const { startDate, endDate, periodType, page = '1', limit = '20' } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(1)); // First day of month
      const end = endDate ? new Date(endDate as string) : new Date(); // Today

      const revenues = await revenueService.getPartnerRevenueByPeriod(
        partnerId,
        start,
        end,
        (periodType as 'DAILY' | 'WEEKLY' | 'MONTHLY') || 'MONTHLY'
      );

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;
      const paginatedRevenues = revenues.slice(skip, skip + limitNum);

      res.json({
        revenues: paginatedRevenues,
        total: revenues.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(revenues.length / limitNum),
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/admin/revenue/summary
   * Get platform revenue summary (admin only)
   */
  async getPlatformRevenueSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;

      const summary = await revenueService.getPlatformRevenueSummary(start, end);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/admin/revenue
   * Get platform revenue records (admin only)
   */
  async getPlatformRevenue(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, periodType, partnerId, page = '1', limit = '20' } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(1)); // First day of month
      const end = endDate ? new Date(endDate as string) : new Date(); // Today

      let revenues = await revenueService.getPlatformRevenueByPeriod(
        start,
        end,
        (periodType as 'DAILY' | 'WEEKLY' | 'MONTHLY') || 'MONTHLY'
      );

      // Filter by partner if specified
      if (partnerId) {
        revenues = revenues.filter(r => r.partnerId === partnerId);
      }

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;
      const paginatedRevenues = revenues.slice(skip, skip + limitNum);

      res.json({
        revenues: paginatedRevenues,
        total: revenues.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(revenues.length / limitNum),
      });
    } catch (error) {
      next(error);
    }
  },
};



