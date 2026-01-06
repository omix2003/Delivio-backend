import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { ForbiddenError } from '../utils/errors.util';

/**
 * Middleware to check maintenance mode
 * Blocks all non-admin access when maintenance mode is enabled
 */
export const checkMaintenanceMode = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Skip maintenance check for admin routes and login endpoint
    if (req.path.startsWith('/api/admin') || (req.path.startsWith('/api/auth') && req.method === 'POST' && req.path.includes('login'))) {
      return next();
    }

    // Get system settings
    let settings;
    try {
      settings = await prisma.systemSettings.findUnique({
        where: { id: 'system' },
      });
    } catch (error: any) {
      // If table doesn't exist, allow access (migration may not have run)
      if (error?.code === 'P2021' || error?.code === '42P01' || error?.message?.includes('does not exist')) {
        return next();
      }
      throw error;
    }

    // If maintenance mode is enabled and user is not admin, block access
    if (settings?.maintenanceMode) {
      const user = req.user;
      if (!user || user.role !== 'ADMIN') {
        return res.status(503).json({
          error: 'Service temporarily unavailable',
          message: 'The system is currently under maintenance. Please try again later.',
          maintenanceMode: true,
        });
      }
    }

    next();
  } catch (error) {
    // On error, allow access (fail open)
    console.error('[Maintenance Middleware] Error checking maintenance mode:', error);
    next();
  }
};

