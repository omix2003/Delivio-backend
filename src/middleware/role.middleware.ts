import {Request, Response, NextFunction} from 'express';
import { ForbiddenError } from '../utils/errors.util';
import { UserRole } from '@prisma/client';

export const requireRole = (...allowedRoles: UserRole[]) => {
    return (req: Request, res: Response, next: NextFunction) =>{
        if(!req.user){
            next(new ForbiddenError('Authentication required'));
            return;
        }
        if(!allowedRoles.includes(req.user.role as UserRole)){
            next(new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(' or ')}`));
            return;
        }
        next();
    };
};
export const requireAdmin = requireRole(UserRole.ADMIN);
export const requireAgent = requireRole(UserRole.AGENT);
export const requirePartner = requireRole(UserRole.PARTNER);
export const requireLogisticsProvider = requireRole(UserRole.LOGISTICS_PROVIDER);
export const requireAgentOrPartner = requireRole(UserRole.AGENT, UserRole.PARTNER);
export const requireAgentOrAdmin = requireRole(UserRole.AGENT, UserRole.ADMIN);