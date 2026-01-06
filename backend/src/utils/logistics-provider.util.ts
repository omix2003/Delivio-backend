import { prisma } from '../lib/prisma';

/**
 * Utility functions for handling logistics provider operations
 * Handles both new LogisticsProvider model and legacy Partner-based logistics providers
 */

/**
 * Get all possible logistics provider IDs for a given ID
 * This handles the case where a logistics provider might be:
 * 1. A LogisticsProvider model entity
 * 2. A Partner with category LOGISTICS_PROVIDER (legacy)
 * 3. Linked to each other via userId
 */
export async function getPossibleLogisticsProviderIds(logisticsProviderId: string): Promise<string[]> {
  const possibleIds: string[] = [logisticsProviderId];
  
  const logisticsProvider = await prisma.logisticsProvider.findUnique({
    where: { id: logisticsProviderId },
    select: { id: true, userId: true },
  });
  
  const partnerCheck = await prisma.partner.findUnique({
    where: { id: logisticsProviderId },
    select: { id: true, category: true, userId: true },
  });
  
  if (logisticsProvider) {
    const linkedPartner = await prisma.partner.findFirst({
      where: {
        userId: logisticsProvider.userId,
        category: 'LOGISTICS_PROVIDER',
      },
      select: { id: true },
    });
    
    if (linkedPartner && !possibleIds.includes(linkedPartner.id)) {
      possibleIds.push(linkedPartner.id);
    }
  }
  
  if (partnerCheck && partnerCheck.category === 'LOGISTICS_PROVIDER') {
    if (!possibleIds.includes(partnerCheck.id)) {
      possibleIds.push(partnerCheck.id);
    }
  }
  
  return possibleIds;
}

/**
 * Get warehouse IDs belonging to a logistics provider
 */
export async function getLogisticsProviderWarehouses(logisticsProviderId: string): Promise<string[]> {
  const warehouses = await prisma.warehouse.findMany({
    where: {
      OR: [
        { logisticsProviderId: logisticsProviderId },
        { partnerId: logisticsProviderId, partner: { category: 'LOGISTICS_PROVIDER' } },
      ],
    },
    select: { id: true },
  });
  return warehouses.map(w => w.id);
}

/**
 * Build a Prisma where clause for finding orders belonging to a logistics provider
 */
export async function buildLogisticsProviderOrderWhere(
  logisticsProviderId: string,
  additionalConditions?: Record<string, any>
): Promise<any> {
  const possibleLogisticsProviderIds = await getPossibleLogisticsProviderIds(logisticsProviderId);
  const warehouseIds = await getLogisticsProviderWarehouses(logisticsProviderId);
  
  const where: any = {
    OR: [
      { logisticsProviderId: { in: possibleLogisticsProviderIds } },
    ],
  };
  
  if (warehouseIds.length > 0) {
    where.OR.push(
      { originWarehouseId: { in: warehouseIds } },
      { currentWarehouseId: { in: warehouseIds } },
    );
  }
  
  // Merge additional conditions, but preserve OR array
  if (additionalConditions) {
    Object.keys(additionalConditions).forEach(key => {
      if (key === 'OR') {
        // If additionalConditions has OR, merge it with existing OR
        if (Array.isArray(additionalConditions.OR)) {
          where.OR = [...where.OR, ...additionalConditions.OR];
        }
      } else {
        where[key] = additionalConditions[key];
      }
    });
  }
  
  return where;
}

/**
 * Verify that a warehouse belongs to a logistics provider
 */
export async function verifyWarehouseOwnership(
  warehouseId: string,
  logisticsProviderId: string
): Promise<boolean> {
  const warehouse = await prisma.warehouse.findFirst({
    where: {
      id: warehouseId,
      OR: [
        { logisticsProviderId: logisticsProviderId },
        { partnerId: logisticsProviderId, partner: { category: 'LOGISTICS_PROVIDER' } },
      ],
    },
    select: { id: true },
  });
  
  return !!warehouse;
}

