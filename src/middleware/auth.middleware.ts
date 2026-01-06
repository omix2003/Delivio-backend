import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../utils/errors.util';

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email: string;
                role: string;
                agentId?: string;
                partnerId?: string;
                logisticsProviderId?: string;

            };
        }
    }
}

export const authenticate = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Express lowercases header names, so 'authorization' is correct
        const authHeader = req.headers.authorization || req.headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            next(new UnauthorizedError('No token provided'));
            return;
        }
        const token = authHeader.substring(7);
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET || 'djfhfudfhcnuyedufcy5482dfdf',
        ) as {
            id: string;
            email: string;
            role: string;
            agentId?: string;
            partnerId?: string;
            logisticsProviderId?: string;
        };
        req.user = decoded;

        next();
    }
    catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            next(new UnauthorizedError('Invalid token'));
            return;
        }
        if (error instanceof jwt.TokenExpiredError) {
            next(new UnauthorizedError('Token expired'));
            return;
        }
        next(error);
    }
};
