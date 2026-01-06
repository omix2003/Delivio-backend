/**
 * ID Generator Utility
 * Generates human-readable IDs with prefixes:
 * - ADN: Admin users
 * - AGT: Agents
 * - USR: Regular users
 * - ORD: Orders
 * - PRT: Partners
 */

import { prisma } from '../lib/prisma';

export type IdPrefix = 'ADN' | 'AGT' | 'USR' | 'ORD' | 'PRT' | 'LGP';

/**
 * Generate a new ID with prefix and sequential number
 * Format: PREFIX + zero-padded number (e.g., ADN001, AGT042, ORD1234)
 */
export async function generateId(prefix: IdPrefix): Promise<string> {
  // Get the last ID with this prefix
  let lastNumber = 0;

  try {
    switch (prefix) {
      case 'ADN':
        // Find last admin user with ADN prefix
        const lastAdmin = await prisma.user.findFirst({
          where: {
            role: 'ADMIN',
            id: { startsWith: 'ADN' },
          },
          orderBy: { id: 'desc' },
        });
        if (lastAdmin && lastAdmin.id.startsWith('ADN')) {
          const match = lastAdmin.id.match(/^ADN(\d+)$/);
          if (match) {
            lastNumber = parseInt(match[1], 10);
          }
        }
        // Also check for any user with ADN prefix (in case role changed)
        const allAdmins = await prisma.user.findMany({
          where: {
            id: { startsWith: 'ADN' },
          },
          orderBy: { id: 'desc' },
          take: 1,
        });
        if (allAdmins.length > 0 && allAdmins[0].id.startsWith('ADN')) {
          const match = allAdmins[0].id.match(/^ADN(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > lastNumber) lastNumber = num;
          }
        }
        break;

      case 'AGT':
        // Find last agent with AGT prefix
        const lastAgent = await prisma.agent.findFirst({
          where: {
            id: { startsWith: 'AGT' },
          },
          orderBy: { id: 'desc' },
        });
        if (lastAgent && lastAgent.id.startsWith('AGT')) {
          const match = lastAgent.id.match(/^AGT(\d+)$/);
          if (match) {
            lastNumber = parseInt(match[1], 10);
          }
        }
        break;

      case 'USR':
        // Find last user with USR prefix (non-admin, non-agent, non-partner)
        const lastUser = await prisma.user.findFirst({
          where: {
            id: { startsWith: 'USR' },
            role: { not: 'ADMIN' },
            agent: null,
            partner: null,
          },
          orderBy: { id: 'desc' },
        });
        if (lastUser && lastUser.id.startsWith('USR')) {
          const match = lastUser.id.match(/^USR(\d+)$/);
          if (match) {
            lastNumber = parseInt(match[1], 10);
          }
        }
        break;

      case 'ORD':
        // Find last order with ORD prefix
        const lastOrder = await prisma.order.findFirst({
          where: {
            id: { startsWith: 'ORD' },
          },
          orderBy: { id: 'desc' },
        });
        if (lastOrder && lastOrder.id.startsWith('ORD')) {
          const match = lastOrder.id.match(/^ORD(\d+)$/);
          if (match) {
            lastNumber = parseInt(match[1], 10);
          }
        }
        break;

      case 'PRT':
        // Find last partner with PRT prefix
        const lastPartner = await prisma.partner.findFirst({
          where: {
            id: { startsWith: 'PRT' },
          },
          orderBy: { id: 'desc' },
        });
        if (lastPartner && lastPartner.id.startsWith('PRT')) {
          const match = lastPartner.id.match(/^PRT(\d+)$/);
          if (match) {
            lastNumber = parseInt(match[1], 10);
          }
        }
        break;

      case 'LGP':
        // Find last logistics provider with LGP prefix
        const lastLogisticsProvider = await prisma.logisticsProvider.findFirst({
          where: {
            id: { startsWith: 'LGP' },
          },
          orderBy: { id: 'desc' },
        });
        if (lastLogisticsProvider && lastLogisticsProvider.id.startsWith('LGP')) {
          const match = lastLogisticsProvider.id.match(/^LGP(\d+)$/);
          if (match) {
            lastNumber = parseInt(match[1], 10);
          }
        }
        break;
    }
  } catch (error) {
    // If query fails (e.g., table doesn't exist), start from 0
    console.error(`Error finding last ${prefix} ID:`, error);
    lastNumber = 0;
  }

  // Increment and format with zero-padding (minimum 3 digits, can grow)
  const nextNumber = lastNumber + 1;
  const paddedNumber = nextNumber.toString().padStart(3, '0');
  
  return `${prefix}${paddedNumber}`;
}

/**
 * Get ID prefix based on user role
 */
export function getUserPrefix(role: 'AGENT' | 'PARTNER' | 'ADMIN' | 'LOGISTICS_PROVIDER'): IdPrefix {
  switch (role) {
    case 'ADMIN':
      return 'ADN';
    case 'AGENT':
      return 'AGT';
    case 'PARTNER':
      return 'PRT';
    case 'LOGISTICS_PROVIDER':
      return 'LGP';
    default:
      return 'USR';
  }
}

