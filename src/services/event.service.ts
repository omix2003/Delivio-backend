import { prisma } from '../lib/prisma';
import { EventType, ActorType } from '@prisma/client';

export interface LogEventParams {
  userId?: string;
  actorType: ActorType;
  eventType: EventType;
  entityType?: 'ORDER' | 'AGENT' | 'PARTNER' | 'USER' | 'TICKET';
  entityId?: string;
  metadata?: Record<string, any>;
}

/**
 * Comprehensive event logging service
 * Logs all important events in the system for analytics and auditing
 */
export const eventService = {
  /**
   * Log an event to the database
   * This is non-blocking and won't throw errors to avoid disrupting main flow
   */
  async logEvent(params: LogEventParams): Promise<void> {
    try {
      await prisma.appEvent.create({
        data: {
          userId: params.userId,
          actorType: params.actorType,
          eventType: params.eventType,
          entityType: params.entityType,
          entityId: params.entityId,
          metadata: params.metadata || {},
        },
      });
    } catch (error) {
      // Log error but don't throw - event logging should never break the main flow
      console.error('[EventService] Failed to log event:', error);
    }
  },

  /**
   * Log order-related events
   */
  async logOrderEvent(
    eventType: EventType,
    orderId: string,
    actorType: ActorType,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      userId,
      actorType,
      eventType,
      entityType: 'ORDER',
      entityId: orderId,
      metadata,
    });
  },

  /**
   * Log agent-related events
   */
  async logAgentEvent(
    eventType: EventType,
    agentId: string,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      userId,
      actorType: ActorType.AGENT,
      eventType,
      entityType: 'AGENT',
      entityId: agentId,
      metadata,
    });
  },

  /**
   * Log partner-related events
   */
  async logPartnerEvent(
    eventType: EventType,
    partnerId: string,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      userId,
      actorType: ActorType.PARTNER,
      eventType,
      entityType: 'PARTNER',
      entityId: partnerId,
      metadata,
    });
  },

  /**
   * Log admin/system events
   */
  async logAdminEvent(
    eventType: EventType,
    userId: string | undefined,
    entityType?: 'ORDER' | 'AGENT' | 'PARTNER' | 'USER' | 'TICKET',
    entityId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      userId,
      actorType: ActorType.ADMIN,
      eventType,
      entityType,
      entityId,
      metadata,
    });
  },

  /**
   * Log system events (automated actions)
   */
  async logSystemEvent(
    eventType: EventType,
    entityType?: 'ORDER' | 'AGENT' | 'PARTNER' | 'USER' | 'TICKET',
    entityId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      actorType: ActorType.SYSTEM,
      eventType,
      entityType,
      entityId,
      metadata,
    });
  },

  /**
   * Get events for analytics
   */
  async getEvents(params: {
    eventType?: EventType;
    actorType?: ActorType;
    entityType?: string;
    entityId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (params.eventType) {
      where.eventType = params.eventType;
    }

    if (params.actorType) {
      where.actorType = params.actorType;
    }

    if (params.entityType) {
      where.entityType = params.entityType;
    }

    if (params.entityId) {
      where.entityId = params.entityId;
    }

    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) {
        where.createdAt.gte = params.startDate;
      }
      if (params.endDate) {
        where.createdAt.lte = params.endDate;
      }
    }

    const [events, total] = await Promise.all([
      prisma.appEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit || 100,
        skip: params.offset || 0,
      }),
      prisma.appEvent.count({ where }),
    ]);

    return {
      events,
      total,
      limit: params.limit || 100,
      offset: params.offset || 0,
    };
  },
};

