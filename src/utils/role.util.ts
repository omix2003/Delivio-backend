import { UserRole } from '@prisma/client';
import {Request } from 'express';

export const hasRole =(req: Request, role: UserRole) : boolean =>{
return req.user?.role === role;
}

export const hasAnyRole =(req:Request, ...roles: UserRole[]): boolean =>{
    if(!req.user){
        return false;
    }
    return roles.includes(req.user?.role as UserRole);
};

export const isAdmin =(req:Request): boolean =>{
    return hasRole(req, UserRole.ADMIN);
};
export const isPartner =(req:Request): boolean =>{
    return hasRole(req, UserRole.PARTNER);
};

export const isAgentOrPartner = (req: Request): boolean => {
    return hasAnyRole(req, UserRole.AGENT, UserRole.PARTNER);
};

export const getUserRole =(req:Request): UserRole | null =>{
    return (req.user?.role as UserRole) || null;
}

export const getUserId= (req:Request): string | null =>{
    return req.user?.id || null;
}

export const getAgentId= (req:Request): string | null =>{
    return req.user?.agentId || null;
}

export const getPartnerId= (req:Request): string | null =>{
    return req.user?.partnerId || null;
};

export const getLogisticsProviderId = (req: Request): string | null => {
    return req.user?.logisticsProviderId || null;
};
