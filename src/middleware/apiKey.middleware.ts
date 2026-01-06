import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { UnauthorizedError } from '../utils/errors.util';

declare global {
  namespace Express {
    interface Request {
      partner?: {
        id: string;
        partnerId: string;
        companyName: string;
        isActive: boolean;
      };
    }
  }
}

/**
 * Middleware to authenticate requests using API key
 * Used for external partner API access
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get API key from header (X-API-Key or Authorization Bearer)
    const apiKey = 
      req.headers['x-api-key'] as string ||
      (req.headers.authorization?.startsWith('Bearer ') 
        ? req.headers.authorization.substring(7)
        : null);

    if (!apiKey) {
      return next(new UnauthorizedError('API key is required'));
    }

    // Find partner by API key
    const partner = await prisma.partner.findUnique({
      where: { apiKey },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!partner) {
      return next(new UnauthorizedError('Invalid API key'));
    }

    if (!partner.isActive) {
      return next(new UnauthorizedError('Partner account is not active'));
    }

    // Attach partner info to request
    req.partner = {
      id: partner.user.id,
      partnerId: partner.id,
      companyName: partner.companyName,
      isActive: partner.isActive,
    };

    next();
  } catch (error) {
    next(error);
  }
};


























