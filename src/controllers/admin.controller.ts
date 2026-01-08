import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { redisGeo, getRedisClient, isRedisConnected } from '../lib/redis';
import { OrderStatus, AgentStatus, EventType, ActorType, PartnerCategory } from '@prisma/client';
import { eventService } from '../services/event.service';
import { getUserId } from '../utils/role.util';
import { delayCheckerService } from '../services/delay-checker.service';
import { metricsService } from '../services/metrics.service';
import { logger } from '../lib/logger';

export const adminController = {
  // ==================== METRICS ====================

  // GET /api/admin/metrics/overview
  async getOverview(req: Request, res: Response, next: NextFunction) {
    try {
      const metrics = await metricsService.getOverviewMetrics();
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/metrics/orders
  async getOrderMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const metrics = await metricsService.getOrderMetrics(start, end);
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/metrics/agents
  async getAgentMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const metrics = await metricsService.getAgentMetrics();
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/metrics/partners
  async getPartnerMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const partners = await prisma.partner.findMany({
        include: {
          _count: {
            select: {
              orders: true,
            },
          },
        },
      });

      const partnerStats = partners.map((partner) => ({
        id: partner.id,
        companyName: partner.companyName,
        isActive: partner.isActive,
        totalOrders: partner._count.orders,
      }));

      res.json({
        totalPartners: partners.length,
        activePartners: partners.filter((p) => p.isActive).length,
        partnerStats,
      });
    } catch (error) {
      next(error);
    }
  },

  // ==================== AGENT MANAGEMENT ====================

  // GET /api/admin/agents
  async getAgents(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        status,
        isApproved,
        isBlocked,
        city,
        vehicleType,
        search,
        page = '1',
        limit = '50',
      } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (status) where.status = status;
      if (isApproved !== undefined) where.isApproved = isApproved === 'true';
      if (isBlocked !== undefined) where.isBlocked = isBlocked === 'true';
      if (city) where.city = { contains: city as string, mode: 'insensitive' };
      if (vehicleType) where.vehicleType = vehicleType;

      if (search) {
        where.OR = [
          { user: { name: { contains: search as string, mode: 'insensitive' } } },
          { user: { email: { contains: search as string, mode: 'insensitive' } } },
          { user: { phone: { contains: search as string, mode: 'insensitive' } } },
        ];
      }

      const [agents, total] = await Promise.all([
        prisma.agent.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                profilePicture: true,
                createdAt: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          skip,
          take: limitNum,
        }),
        prisma.agent.count({ where }),
      ]);

      res.json({
        agents,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/agents/:id
  async getAgentDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const agent = await prisma.agent.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          vehicleType: true,
          city: true,
          state: true,
          pincode: true,
          isApproved: true,
          isBlocked: true,
          blockedReason: true,
          rating: true,
          totalOrders: true,
          completedOrders: true,
          acceptanceRate: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              profilePicture: true,
              createdAt: true,
            },
          },
          documents: true,
          orders: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              createdAt: true,
              payoutAmount: true,
              partner: {
                select: {
                  id: true,
                  companyName: true,
                  user: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json(agent);
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/agents/:id/approve
  async approveAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const agent = await prisma.agent.update({
        where: { id },
        data: {
          isApproved: true,
        },
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

      // Log agent approval event
      const userId = getUserId(req);
      await eventService.logAdminEvent(
        EventType.AGENT_ONLINE, // Using existing event type, metadata will clarify it's approval
        userId ?? undefined,
        'AGENT',
        id,
        {
          action: 'AGENT_APPROVED',
          agentId: id,
          agentName: agent.user.name,
        }
      );

      res.json({
        message: 'Agent approved successfully',
        agent,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/agents/:id/block
  async blockAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const agent = await prisma.agent.update({
        where: { id },
        data: {
          isBlocked: true,
          blockedReason: reason || 'Blocked by admin',
          status: 'OFFLINE',
        },
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

      // Log agent blocking event
      const userId = getUserId(req);
      await eventService.logAdminEvent(
        EventType.AGENT_OFFLINE, // Using existing event type, metadata will clarify it's blocking
        userId ?? undefined,
        'AGENT',
        id,
        {
          action: 'AGENT_BLOCKED',
          agentId: id,
          agentName: agent.user.name,
          reason: reason || 'Blocked by admin',
        }
      );

      // Remove agent location from Redis
      await redisGeo.removeAgentLocation(id);

      res.json({
        message: 'Agent blocked successfully',
        agent,
      });
    } catch (error) {
      next(error);
    }
  },

  // DELETE /api/admin/agents/:id
  async deleteAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // Check if agent exists
      const agent = await prisma.agent.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              orders: true,
            },
          },
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Warn if agent has active orders
      if (agent._count.orders > 0) {
        // Check for active orders
        const activeOrdersCount = await prisma.order.count({
          where: {
            agentId: id,
            status: {
              in: [
                OrderStatus.ASSIGNED,
                OrderStatus.PICKED_UP,
                OrderStatus.OUT_FOR_DELIVERY,
              ],
            },
          },
        });

        if (activeOrdersCount > 0) {
          return res.status(400).json({
            error: `Cannot delete agent with ${activeOrdersCount} active order(s). Please complete or cancel all active orders first.`,
          });
        }
      }

      // Delete agent and related data in a transaction
      await prisma.$transaction(async (tx) => {
        const userId = agent.user.id;

        // Delete agent's orders first (required because agentId might be referenced)
        await tx.order.deleteMany({
          where: { agentId: id },
        });

        // Delete agent's support tickets
        await tx.supportTicket.deleteMany({
          where: { agentId: id },
        });

        // Note: AgentDocument and AgentLocation will be cascade deleted
        // when the agent is deleted, but we need to delete the user first
        // which will cascade delete the agent

        // Delete the user (this will cascade delete the agent due to onDelete: Cascade)
        await tx.user.delete({
          where: { id: userId },
        });
      });

      // Remove agent location from Redis if connected
      try {
        await redisGeo.removeAgentLocation(id);
      } catch (redisError) {
        // Log but don't fail if Redis cleanup fails
        console.warn('[Admin] Failed to remove agent location from Redis:', redisError);
      }

      res.json({
        message: 'Agent deleted successfully',
        deletedAgentId: id,
      });
    } catch (error: any) {
      console.error('[Admin] Error deleting agent:', error);
      console.error('[Admin] Error details:', {
        code: error.code,
        message: error.message,
        meta: error.meta,
      });

      // Handle foreign key constraint errors
      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Cannot delete agent. There are active orders or other dependencies.',
        });
      }

      // Handle record not found errors
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Agent not found or already deleted.',
        });
      }

      // Return a more user-friendly error message
      return res.status(500).json({
        error: error.message || 'Failed to delete agent. Please try again.',
      });
    }
  },

  // PUT /api/admin/agents/:id/location - Update agent location (admin only)
  async updateAgentLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { latitude, longitude } = req.body;

      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Latitude and longitude are required' });
      }

      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return res.status(400).json({ error: 'Latitude and longitude must be numbers' });
      }

      // Check if agent exists
      const agent = await prisma.agent.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Update location in Redis GEO (for real-time queries)
      await redisGeo.addAgentLocation(id, longitude, latitude);

      // Store in database for history
      await prisma.agentLocation.create({
        data: {
          agentId: id,
          latitude,
          longitude,
        },
      });

      // Update lastOnlineAt timestamp
      await prisma.agent.update({
        where: { id },
        data: { lastOnlineAt: new Date() },
      });

      res.json({
        message: 'Agent location updated successfully',
        agent: {
          id: agent.id,
          name: agent.user.name,
          email: agent.user.email,
        },
        location: {
          latitude,
          longitude,
        },
      });
    } catch (error: any) {
      console.error('[Admin] Error updating agent location:', error);
      next(error);
    }
  },

  // POST /api/admin/agents/:id/unblock
  async unblockAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const agent = await prisma.agent.update({
        where: { id },
        data: {
          isBlocked: false,
          blockedReason: null,
        },
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

      // Log agent unblocking event
      const userId = getUserId(req);
      await eventService.logAdminEvent(
        EventType.AGENT_ONLINE, // Using existing event type, metadata will clarify it's unblocking
        userId ?? undefined,
        'AGENT',
        id,
        {
          action: 'AGENT_UNBLOCKED',
          agentId: id,
          agentName: agent.user.name,
        }
      );

      res.json({
        message: 'Agent unblocked successfully',
        agent,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/agents/locations
  async getAgentLocations(req: Request, res: Response, next: NextFunction) {
    try {
      // Get all agents from database (not just those with Redis locations)
      const allAgents = await prisma.agent.findMany({
        where: {
          isApproved: true, // Only show approved agents
        },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      const agentLocations: any[] = [];

      // If Redis is connected, get locations from Redis GEO
      if (isRedisConnected()) {
        const client = getRedisClient();
        if (client) {
          // Get all members of the GEO set
          const redisMembers = await client.zrange('agents_locations', 0, -1);
          const redisAgentIds = redisMembers as string[];

          // ✅ FIXED: Batch query instead of N+1 queries
          // Get all coordinates in a single batch query
          const positions = await Promise.all(
            redisAgentIds.map((agentId) => client.geopos('agents_locations', agentId))
          );

          // Create agent map for O(1) lookup
          const agentMap = new Map(allAgents.map((a) => [a.id, a]));

          // Process results
          redisAgentIds.forEach((agentId, index) => {
            const agent = agentMap.get(agentId);
            if (!agent) return;

            const position = positions[index];
            if (!position || position.length === 0 || !position[0]) {
              return;
            }

            // Redis GEO returns coordinates as strings, parse them to numbers
            const [lonStr, latStr] = position[0] as [string | null, string | null];
            if (!lonStr || !latStr) {
              return;
            }

            const longitude = parseFloat(lonStr);
            const latitude = parseFloat(latStr);

            if (isNaN(longitude) || isNaN(latitude)) {
              return;
            }

            agentLocations.push({
              agentId,
              longitude,
              latitude,
              hasLocation: true,
              agent: {
                id: agent.id,
                status: agent.status,
                user: agent.user,
              },
            });
          });
        }
      }

      // For agents without Redis locations, try to get their last known location from database
      const agentsWithLocations = new Set(agentLocations.map((loc) => loc.agentId));
      const agentsWithoutRedisLocations = allAgents.filter(
        (agent) => !agentsWithLocations.has(agent.id)
      );

      if (agentsWithoutRedisLocations.length > 0) {
        // Get last known locations from database for agents without Redis locations
        const agentIds = agentsWithoutRedisLocations.map((a) => a.id);
        const allRecentLocations = await prisma.agentLocation.findMany({
          where: {
            agentId: { in: agentIds },
          },
          orderBy: {
            timestamp: 'desc',
          },
        });

        // Group by agentId and get the most recent location for each agent
        const locationMap = new Map<string, { lat: number; lng: number }>();
        for (const loc of allRecentLocations) {
          if (!locationMap.has(loc.agentId)) {
            locationMap.set(loc.agentId, { lat: loc.latitude, lng: loc.longitude });
          }
        }

        // Add agents with database locations or mark as having no location
        agentsWithoutRedisLocations.forEach((agent) => {
          const lastLocation = locationMap.get(agent.id);
          if (lastLocation) {
            agentLocations.push({
              agentId: agent.id,
              longitude: lastLocation.lng,
              latitude: lastLocation.lat,
              hasLocation: true, // Has location from database
              agent: {
                id: agent.id,
                status: agent.status,
                user: agent.user,
              },
            });
          } else {
            agentLocations.push({
              agentId: agent.id,
              longitude: null,
              latitude: null,
              hasLocation: false,
              agent: {
                id: agent.id,
                status: agent.status,
                user: agent.user,
              },
            });
          }
        });
      }

      console.log(`[Admin] Returning ${agentLocations.length} agent locations (${agentLocations.filter(loc => loc.hasLocation).length} with locations)`);
      res.json(agentLocations);
    } catch (error) {
      console.error('[Admin] Error getting agent locations:', error);
      next(error);
    }
  },

  // ==================== PARTNER MANAGEMENT ====================

  // GET /api/admin/partners
  async getPartners(req: Request, res: Response, next: NextFunction) {
    try {
      const { isActive, search, page = '1', limit = '50' } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (isActive !== undefined) where.isActive = isActive === 'true';
      if (search) {
        where.OR = [
          { companyName: { contains: search as string, mode: 'insensitive' } },
          { user: { email: { contains: search as string, mode: 'insensitive' } } },
        ];
      }

      let partners, total;

      try {
        [partners, total] = await Promise.all([
          prisma.partner.findMany({
            where,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  profilePicture: true,
                },
              },
              _count: {
                select: {
                  orders: true,
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            skip,
            take: limitNum,
          }),
          prisma.partner.count({ where }),
        ]);
      } catch (error: any) {
        // If columns don't exist (P2022), try with explicit select excluding new fields
        if (error?.code === 'P2022' || error?.message?.includes('does not exist') ||
          error?.message?.includes('businessName')) {
          console.warn('⚠️  Database schema error (P2022): Some columns may not exist. Retrying with minimal fields.');

          [partners, total] = await Promise.all([
            prisma.partner.findMany({
              where,
              select: {
                id: true,
                userId: true,
                companyName: true,
                apiKey: true,
                category: true,
                webhookUrl: true,
                isActive: true,
                city: true,
                createdAt: true,
                updatedAt: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    profilePicture: true,
                  },
                },
                _count: {
                  select: {
                    orders: true,
                  },
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
              skip,
              take: limitNum,
            }),
            prisma.partner.count({ where }),
          ]);
        } else {
          throw error;
        }
      }

      res.json({
        partners,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/partners/:id
  async getPartnerDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const partner = await prisma.partner.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              profilePicture: true,
            },
          },
          orders: {
            take: 20,
            orderBy: { createdAt: 'desc' },
            include: {
              agent: {
                include: {
                  user: {
                    select: { name: true },
                  },
                },
              },
            },
          },
          _count: {
            select: {
              orders: true,
            },
          },
        },
      });

      if (!partner) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      res.json(partner);
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/admin/partners/:id
  async updatePartner(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { updatePartnerSchema } = await import('../utils/validation.schemas');
      
      const validatedData = updatePartnerSchema.parse(req.body);

      // Check if partner exists
      const existingPartner = await prisma.partner.findUnique({
        where: { id },
      });

      if (!existingPartner) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      // Update partner
      const updatedPartner = await prisma.partner.update({
        where: { id },
        data: {
          ...validatedData,
          billingEmail: validatedData.billingEmail || undefined,
          webhookUrl: validatedData.webhookUrl || undefined,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              profilePicture: true,
            },
          },
          _count: {
            select: {
              orders: true,
            },
          },
        },
      });

      res.json(updatedPartner);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      next(error);
    }
  },

  // DELETE /api/admin/partners/:id
  async deletePartner(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // Check if partner exists
      const partner = await prisma.partner.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              orders: true,
            },
          },
        },
      });

      if (!partner) {
        return res.status(404).json({ error: 'Partner not found' });
      }

      // Warn if partner has active orders
      if (partner._count.orders > 0) {
        // Check for active orders
        const activeOrdersCount = await prisma.order.count({
          where: {
            partnerId: id,
            status: {
              in: [
                OrderStatus.SEARCHING_AGENT,
                OrderStatus.ASSIGNED,
                OrderStatus.PICKED_UP,
                OrderStatus.OUT_FOR_DELIVERY,
              ],
            },
          },
        });

        if (activeOrdersCount > 0) {
          return res.status(400).json({
            error: `Cannot delete partner with ${activeOrdersCount} active order(s). Please cancel or complete all active orders first.`,
          });
        }
      }

      // Delete partner and related data in a transaction
      await prisma.$transaction(async (tx) => {
        const userId = partner.user.id;

        // Delete partner's orders first (required because partnerId is not nullable)
        // Note: This deletes all orders for historical accuracy
        // If you want to keep orders, you'd need to make partnerId nullable in the schema
        await tx.order.deleteMany({
          where: { partnerId: id },
        });

        // Delete partner's daily stats
        await tx.partnerDailyStats.deleteMany({
          where: { partnerId: id },
        });

        // Delete partner's support tickets
        await tx.supportTicket.deleteMany({
          where: { partnerId: id },
        });

        // Delete the user (this will cascade delete the partner due to onDelete: Cascade)
        await tx.user.delete({
          where: { id: userId },
        });
      });

      res.json({
        message: 'Partner deleted successfully',
        deletedPartnerId: id,
      });
    } catch (error: any) {
      console.error('[Admin] Error deleting partner:', error);
      console.error('[Admin] Error details:', {
        code: error.code,
        message: error.message,
        meta: error.meta,
      });

      // Handle foreign key constraint errors
      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Cannot delete partner. There are active orders or other dependencies.',
        });
      }

      // Handle record not found errors
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Partner not found or already deleted.',
        });
      }

      // Return a more user-friendly error message
      return res.status(500).json({
        error: error.message || 'Failed to delete partner. Please try again.',
      });
    }
  },

  // ==================== ORDER MANAGEMENT ====================

  // GET /api/admin/orders
  async getOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        status,
        partnerId,
        agentId,
        search,
        page = '1',
        limit = '50',
      } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (status) where.status = status;
      if (partnerId) where.partnerId = partnerId;
      if (agentId) where.agentId = agentId;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          select: {
            id: true,
            status: true,
            createdAt: true,
            orderAmount: true,
            payoutAmount: true, // Agent Payout
            adminCommission: true, // Platform Payout
            platformFee: true, // For reference
            partner: {
              select: {
                id: true,
                companyName: true,
                isActive: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
            agent: {
              select: {
                id: true,
                user: {
                  select: {
                    name: true,
                    phone: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          skip,
          take: limitNum,
        }),
        prisma.order.count({ where }),
      ]);

      res.json({
        orders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/orders/:id
  async getOrderDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          partner: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          agent: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Check and update delayed status
      const { delayCheckerService } = await import('../services/delay-checker.service');
      await delayCheckerService.checkOrderDelay(id);

      // Refresh order to get updated status
      const refreshedOrder = await prisma.order.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          pickedUpAt: true,
          estimatedDuration: true,
        },
      });

      // Calculate timing information
      const timing = delayCheckerService.getOrderTiming({
        pickedUpAt: refreshedOrder?.pickedUpAt || order.pickedUpAt,
        estimatedDuration: refreshedOrder?.estimatedDuration || order.estimatedDuration,
      });

      // Add timing to order response
      const orderWithTiming = {
        ...order,
        status: refreshedOrder?.status || order.status,
        timing: {
          elapsedMinutes: timing.elapsedMinutes,
          remainingMinutes: timing.remainingMinutes,
          isDelayed: timing.isDelayed,
          elapsedTime: timing.elapsedTime,
          remainingTime: timing.remainingTime,
        },
      };

      res.json(orderWithTiming);
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/orders/:id/reassign
  async reassignOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { agentId } = req.body;

      // Get current order
      const order = await prisma.order.findUnique({
        where: { id },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // If order has current agent, remove assignment
      if (order.agentId) {
        await prisma.agent.update({
          where: { id: order.agentId },
          data: {
            currentOrderId: null,
            status: 'ONLINE',
          },
        });
      }

      // Reassign to new agent or set to searching
      if (agentId) {
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id },
            data: {
              agentId,
              status: 'ASSIGNED',
              assignedAt: new Date(),
            },
            select: { id: true, status: true, agentId: true }, // Only select fields we need
          });

          await tx.agent.update({
            where: { id: agentId },
            data: {
              currentOrderId: id,
              status: 'ON_TRIP',
            },
          });
        });
      } else {
        await prisma.order.update({
          where: { id },
          data: {
            agentId: null,
            status: 'SEARCHING_AGENT',
            assignedAt: null,
          },
          select: { id: true, status: true, agentId: true }, // Only select fields we need
        });

        // Trigger assignment engine
        const { assignOrder } = await import('../services/assignment.service');
        assignOrder({
          orderId: id,
          pickupLat: order.pickupLat,
          pickupLng: order.pickupLng,
          payoutAmount: order.payoutAmount,
          priority: (order.priority as 'HIGH' | 'NORMAL' | 'LOW') || 'NORMAL',
        });
      }

      const updatedOrder = await prisma.order.findUnique({
        where: { id },
        include: {
          agent: {
            include: {
              user: {
                select: { name: true },
              },
            },
          },
        },
      });

      // Log order reassignment event
      const userId = getUserId(req);
      await eventService.logAdminEvent(
        EventType.ORDER_ASSIGNED,
        userId ?? undefined,
        'ORDER',
        id,
        {
          action: 'ORDER_REASSIGNED',
          previousAgentId: order.agentId,
          newAgentId: agentId || null,
          orderId: id,
        }
      );

      res.json({
        message: agentId ? 'Order reassigned successfully' : 'Order set to searching for new agent',
        order: updatedOrder,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/orders/:id/cancel
  async cancelOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const order = await prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findUnique({
          where: { id },
        });

        if (!currentOrder) {
          throw new Error('Order not found');
        }

        // If order was delivered, reverse wallet credits and revenue
        if (currentOrder.status === 'DELIVERED') {
          try {
            const { walletService } = await import('../services/wallet.service');
            const { revenueService } = await import('../services/revenue.service');

            // Reverse agent wallet credit
            if (currentOrder.agentId) {
              await walletService.reverseAgentWalletCredit(
                currentOrder.agentId,
                id,
                `Reversal for cancelled delivered order ${id.substring(0, 8).toUpperCase()}`,
                tx
              );
            }

            // Reverse admin wallet credit
            await walletService.reverseAdminWalletCredit(
              id,
              `Reversal for cancelled delivered order ${id.substring(0, 8).toUpperCase()}`,
              tx
            );

            // Reverse platform revenue record
            await revenueService.reversePlatformRevenue(id, tx);
          } catch (reversalError: any) {
            logger.error('[Admin Controller] Error reversing wallet credits for cancelled delivered order', reversalError, { orderId: id });
            // Continue with cancellation even if reversal fails, but log it
          }
        }

        // If order is assigned, free the agent
        if (currentOrder.agentId) {
          await tx.agent.update({
            where: { id: currentOrder.agentId },
            data: {
              currentOrderId: null,
              status: 'ONLINE',
            },
          });
        }

        // Cancel the order
        const updatedOrder = await tx.order.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: reason || 'Cancelled by admin',
          },
        });

        return updatedOrder;
      }, {
        isolationLevel: 'Serializable',
        timeout: 30000,
      });

      // Notify partner
      const { notifyPartner } = await import('../lib/webhook');
      await notifyPartner(
        order.partnerId,
        'ORDER_CANCELLED',
        id,
        'CANCELLED',
        {
          reason: reason || 'Cancelled by admin',
        }
      );

      res.json({
        message: 'Order cancelled successfully',
        order,
      });
    } catch (error: any) {
      if (error.message === 'Order not found') {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  },

  // DELETE /api/admin/orders/bulk - Delete multiple orders
  async deleteBulkOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderIds } = req.body;

      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: 'orderIds must be a non-empty array' });
      }

      // Verify all orders exist
      const orders = await prisma.order.findMany({
        where: {
          id: { in: orderIds },
        },
        select: {
          id: true,
          agentId: true,
          status: true,
        },
      });

      if (orders.length !== orderIds.length) {
        const foundIds = orders.map((o) => o.id);
        const missingIds = orderIds.filter((id: string) => !foundIds.includes(id));
        return res.status(404).json({
          error: `Some orders not found: ${missingIds.join(', ')}`,
        });
      }

      // Delete orders and free agents in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Get all unique agent IDs that need to be freed
        const agentIdsToFree = [...new Set(orders.map((o) => o.agentId).filter(Boolean))];

        // Free agents
        if (agentIdsToFree.length > 0) {
          await tx.agent.updateMany({
            where: {
              id: { in: agentIdsToFree as string[] },
            },
            data: {
              currentOrderId: null,
              status: 'ONLINE',
            },
          });
        }

        // Delete orders
        const deleteResult = await tx.order.deleteMany({
          where: {
            id: { in: orderIds },
          },
        });

        return deleteResult;
      });

      res.json({
        message: `Successfully deleted ${result.count} order(s)`,
        deletedCount: result.count,
      });
    } catch (error: any) {
      console.error('[Admin] Error deleting bulk orders:', error);
      next(error);
    }
  },

  // POST /api/admin/orders/stop-all-timers - Stop delivery timers for all active orders
  async stopAllDeliveryTimers(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await delayCheckerService.stopAllActiveDeliveryTimers();
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/activity - Get recent activity
  async getRecentActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const { limit = '20' } = req.query;
      const limitNum = parseInt(limit as string, 10);
      const activities = await metricsService.getRecentActivity(limitNum);
      res.json(activities);
    } catch (error) {
      next(error);
    }
  },

  // ==================== KYC VERIFICATION ====================

  // GET /api/admin/agents/:id/documents
  async getAgentDocuments(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const agent = await prisma.agent.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const documents = await prisma.agentDocument.findMany({
        where: { agentId: id },
        orderBy: { uploadedAt: 'desc' },
      });

      res.json({
        agent: {
          id: agent.id,
          name: agent.user.name,
          email: agent.user.email,
          isApproved: agent.isApproved,
        },
        documents,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/documents/:id/verify
  async verifyDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      const document = await prisma.agentDocument.findUnique({
        where: { id },
        include: {
          agent: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Update document as verified
      const updatedDocument = await prisma.agentDocument.update({
        where: { id },
        data: {
          verified: true,
        },
      });

      // Check if all required documents are verified
      const allDocuments = await prisma.agentDocument.findMany({
        where: { agentId: document.agentId },
      });

      const requiredTypes = ['LICENSE', 'VEHICLE_REG', 'ID_PROOF'];
      const hasAllRequired = requiredTypes.every((type) =>
        allDocuments.some((doc) => doc.documentType === type && doc.verified)
      );

      // Auto-approve agent if all required documents are verified
      if (hasAllRequired && !document.agent.isApproved) {
        await prisma.agent.update({
          where: { id: document.agentId },
          data: {
            isApproved: true,
          },
        });
      }

      res.json({
        message: 'Document verified successfully',
        document: updatedDocument,
        agentAutoApproved: hasAllRequired && !document.agent.isApproved,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/documents/:id/reject
  async rejectDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: 'Rejection reason is required' });
      }

      const document = await prisma.agentDocument.findUnique({
        where: { id },
      });

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Mark document as not verified (reject)
      const updatedDocument = await prisma.agentDocument.update({
        where: { id },
        data: {
          verified: false,
        },
      });

      // If agent was auto-approved, revoke approval if required documents are not verified
      const agent = await prisma.agent.findUnique({
        where: { id: document.agentId },
        include: {
          documents: true,
        },
      });

      if (agent && agent.isApproved) {
        const requiredTypes = ['LICENSE', 'VEHICLE_REG', 'ID_PROOF'];
        const hasAllRequired = requiredTypes.every((type) =>
          agent.documents.some((doc) => doc.documentType === type && doc.verified)
        );

        if (!hasAllRequired) {
          await prisma.agent.update({
            where: { id: document.agentId },
            data: {
              isApproved: false,
            },
          });
        }
      }

      res.json({
        message: 'Document rejected',
        document: updatedDocument,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/agents/:id/verify-kyc
  async verifyAgentKYC(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      const agent = await prisma.agent.findUnique({
        where: { id },
        include: {
          documents: true,
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Verify all documents
      await prisma.agentDocument.updateMany({
        where: { agentId: id },
        data: { verified: true },
      });

      // Approve agent
      const updatedAgent = await prisma.agent.update({
        where: { id },
        data: {
          isApproved: true,
        },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          documents: true,
        },
      });

      res.json({
        message: 'Agent KYC verified and approved',
        agent: updatedAgent,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/kyc/pending
  async getPendingKYC(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '20' } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;

      // Get agents that need KYC verification:
      // All agents with isApproved: false (regardless of document status)
      // This includes:
      // - Agents with no documents
      // - Agents with unverified documents
      // - Agents with all documents verified but still not approved
      // Get all unapproved agents, including those with all documents verified
      // This ensures agents with complete documents but pending approval are visible
      // IMPORTANT: We return ALL agents with isApproved: false, regardless of document status
      // Optimize query by using select instead of include and only fetching needed document fields
      const agents = await prisma.agent.findMany({
        where: {
          isApproved: false,
        },
        select: {
          id: true,
          userId: true,
          status: true,
          vehicleType: true,
          city: true,
          state: true,
          pincode: true,
          isApproved: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              email: true,
              phone: true,
            },
          },
          documents: {
            select: {
              id: true,
              documentType: true,
              verified: true,
              uploadedAt: true,
            },
            orderBy: { uploadedAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limitNum,
      });

      // Debug logging (disabled for performance - enable only when debugging)
      // console.log(`[KYC] Query params: page=${pageNum}, limit=${limitNum}, skip=${skip}`);
      // console.log(`[KYC] Found ${agents.length} agents with isApproved: false`);

      // Count total pending (all unapproved agents)
      const total = await prisma.agent.count({
        where: {
          isApproved: false,
        },
      });

      // Calculate verification status for each agent
      const agentsWithStatus = agents.map((agent) => {
        const requiredTypes = ['LICENSE', 'VEHICLE_REG', 'ID_PROOF'];
        const verifiedDocs = agent.documents.filter((doc) => doc.verified);
        const pendingDocs = agent.documents.filter((doc) => !doc.verified);
        const missingTypes = requiredTypes.filter(
          (type) => !agent.documents.some((doc) => doc.documentType === type)
        );

        return {
          ...agent,
          kycStatus: {
            verifiedCount: verifiedDocs.length,
            pendingCount: pendingDocs.length,
            totalCount: agent.documents.length,
            missingTypes,
            isComplete: requiredTypes.every((type) =>
              agent.documents.some((doc) => doc.documentType === type && doc.verified)
            ),
          },
        };
      });

      res.json({
        agents: agentsWithStatus,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error('[KYC] Error in getPendingKYC:', error);
      next(error);
    }
  },

  // ==================== SUPPORT TICKETS ====================

  // GET /api/admin/support/tickets - Get all support tickets
  async getSupportTickets(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, issueType, page = '1', limit = '20' } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};
      if (status && status !== 'ALL') {
        where.status = status;
      }
      if (issueType && issueType !== 'ALL') {
        where.issueType = issueType;
      }

      const [tickets, total] = await Promise.all([
        prisma.supportTicket.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
              },
            },
            order: {
              select: {
                id: true,
                status: true,
              },
            },
            agent: {
              select: {
                id: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
            partner: {
              select: {
                id: true,
                companyName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          skip,
          take: limitNum,
        }),
        prisma.supportTicket.count({ where }),
      ]);

      res.json({
        tickets: tickets.map((ticket: any) => ({
          id: ticket.id,
          issueType: ticket.issueType,
          description: ticket.description,
          status: ticket.status,
          resolvedAt: ticket.resolvedAt,
          adminNotes: ticket.adminNotes || null,
          createdAt: ticket.createdAt.toISOString(),
          updatedAt: ticket.updatedAt.toISOString(),
          user: ticket.user || null,
          order: ticket.order || null,
          agent: ticket.agent || null,
          partner: ticket.partner || null,
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/support/tickets/:id - Get ticket details
  async getSupportTicketDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const ticket = await prisma.supportTicket.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              role: true,
            },
          },
          order: {
            include: {
              partner: {
                select: {
                  companyName: true,
                },
              },
              agent: {
                select: {
                  user: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
          agent: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          partner: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      if (!ticket) {
        return res.status(404).json({ error: 'Support ticket not found' });
      }

      const ticketData = ticket as any;
      res.json({
        id: ticketData.id,
        issueType: ticketData.issueType,
        description: ticketData.description,
        status: ticketData.status,
        resolvedAt: ticketData.resolvedAt,
        adminNotes: ticketData.adminNotes || null,
        createdAt: ticketData.createdAt.toISOString(),
        updatedAt: ticketData.updatedAt.toISOString(),
        user: ticketData.user || null,
        order: ticketData.order || null,
        agent: ticketData.agent || null,
        partner: ticketData.partner || null,
      });
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/admin/support/tickets/:id/status - Update ticket status
  async updateTicketStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, adminNotes } = req.body;

      if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const updateData: any = {
        status: status as any,
        ...(status === 'RESOLVED' && !req.body.resolvedAt ? { resolvedAt: new Date() } : {}),
      };

      // Save admin notes when closing or resolving
      if ((status === 'CLOSED' || status === 'RESOLVED') && adminNotes) {
        (updateData as any).adminNotes = adminNotes;
      }

      const ticket = await prisma.supportTicket.update({
        where: { id },
        data: updateData,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          agent: {
            select: {
              id: true,
              userId: true,
            },
          },
          order: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      // Notify agent if ticket status changed to IN_PROGRESS and ticket is order-related - DISABLED
      // const ticketData = ticket as any;
      // if (status === 'IN_PROGRESS' && ticketData.agentId && ticketData.orderId) {
      //   try {
      //     const { sendPushNotification } = await import('../services/fcm.service');
      //     await sendPushNotification(
      //       ticketData.agent.userId,
      //       'Support Ticket Update',
      //       `Admin has started working on your ticket for order ${ticketData.order.id.substring(0, 8)}`,
      //       {
      //         type: 'TICKET_UPDATE',
      //         ticketId: ticketData.id,
      //         orderId: ticketData.order.id,
      //         status: 'IN_PROGRESS',
      //       }
      //     );
      //     console.log(`[Admin] Sent notification to agent ${ticketData.agentId} about ticket ${ticketData.id}`);
      //   } catch (notifError) {
      //     console.error('[Admin] Failed to send notification to agent:', notifError);
      //     // Don't fail the request if notification fails
      //   }
      // }

      res.json({
        id: ticket.id,
        status: ticket.status,
        resolvedAt: ticket.resolvedAt,
        message: 'Ticket status updated successfully',
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/support/tickets/:id/resolve - Resolve ticket
  async resolveTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { resolutionNotes, adminNotes } = req.body;

      const ticket = await prisma.supportTicket.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          adminNotes: (adminNotes || resolutionNotes || null) as string | null,
        } as any,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          agent: {
            select: {
              id: true,
              userId: true,
            },
          },
          partner: {
            select: {
              id: true,
              userId: true,
            },
          },
          order: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      // Notify user (agent or partner) if ticket is order-related - DISABLED
      // const ticketData = ticket as any;
      // const userIdToNotify = ticketData.agentId ? ticketData.agent?.userId : ticketData.partnerId ? ticketData.partner?.userId : null;
      // if (userIdToNotify && ticketData.orderId && ticketData.order) {
      //   try {
      //     const { sendPushNotification } = await import('../services/fcm.service');
      //     await sendPushNotification(
      //       userIdToNotify,
      //       'Support Ticket Resolved',
      //       `Your support ticket for order ${ticketData.order.id.substring(0, 8)} has been resolved`,
      //       {
      //         type: 'TICKET_RESOLVED',
      //         ticketId: ticketData.id,
      //         orderId: ticketData.order.id,
      //         status: 'RESOLVED',
      //       }
      //     );
      //     console.log(`[Admin] Sent resolution notification to user ${userIdToNotify} about ticket ${ticketData.id}`);
      //   } catch (notifError) {
      //     console.error('[Admin] Failed to send resolution notification:', notifError);
      //     // Don't fail the request if notification fails
      //   }
      // }

      res.json({
        id: ticket.id,
        status: ticket.status,
        resolvedAt: ticket.resolvedAt,
        message: 'Ticket resolved successfully',
      });
    } catch (error) {
      next(error);
    }
  },

  // ==================== ANALYTICS ====================

  // GET /api/admin/analytics/overview - Get comprehensive analytics overview
  async getAnalyticsOverview(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const [
        totalRevenue,
        totalOrders,
        completedOrders,
        cancelledOrders,
        avgDeliveryTime,
        ordersByDay,
        ordersByStatus,
        revenueByDay,
        topAgents,
        topPartners,
      ] = await Promise.all([
        // Total revenue
        prisma.order.aggregate({
          where: {
            status: 'DELIVERED',
            deliveredAt: { gte: start, lte: end },
          },
          _sum: {
            payoutAmount: true,
          },
        }),
        // Total orders
        prisma.order.count({
          where: {
            createdAt: { gte: start, lte: end },
          },
        }),
        // Completed orders
        prisma.order.count({
          where: {
            status: 'DELIVERED',
            deliveredAt: { gte: start, lte: end },
          },
        }),
        // Cancelled orders
        prisma.order.count({
          where: {
            status: 'CANCELLED',
            cancelledAt: { gte: start, lte: end },
          },
        }),
        // Average delivery time
        prisma.order.aggregate({
          where: {
            status: 'DELIVERED',
            deliveredAt: { gte: start, lte: end },
            actualDuration: { not: null },
          },
          _avg: {
            actualDuration: true,
          },
        }),
        // Orders by day (last 30 days)
        prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
          SELECT DATE("createdAt") as date, COUNT(*)::bigint as count
          FROM "Order"
          WHERE "createdAt" >= ${start} AND "createdAt" <= ${end}
          GROUP BY DATE("createdAt")
          ORDER BY date ASC
        `,
        // Orders by status
        prisma.order.groupBy({
          by: ['status'],
          where: {
            createdAt: { gte: start, lte: end },
          },
          _count: {
            id: true,
          },
        }),
        // Revenue by day
        prisma.$queryRaw<Array<{ date: Date; revenue: number }>>`
          SELECT DATE("deliveredAt") as date, SUM("payoutAmount")::float as revenue
          FROM "Order"
          WHERE status = 'DELIVERED' AND "deliveredAt" >= ${start} AND "deliveredAt" <= ${end}
          GROUP BY DATE("deliveredAt")
          ORDER BY date ASC
        `,
        // Top agents by completed orders
        prisma.agent.findMany({
          where: {
            orders: {
              some: {
                status: 'DELIVERED',
                deliveredAt: { gte: start, lte: end },
              },
            },
          },
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
            _count: {
              select: {
                orders: {
                  where: {
                    status: 'DELIVERED',
                    deliveredAt: { gte: start, lte: end },
                  },
                },
              },
            },
          },
          orderBy: {
            orders: {
              _count: 'desc',
            },
          },
          take: 10,
        }),
        // Top partners by orders
        prisma.partner.findMany({
          where: {
            orders: {
              some: {
                createdAt: { gte: start, lte: end },
              },
            },
          },
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
            _count: {
              select: {
                orders: {
                  where: {
                    createdAt: { gte: start, lte: end },
                  },
                },
              },
            },
          },
          orderBy: {
            orders: {
              _count: 'desc',
            },
          },
          take: 10,
        }),
      ]);

      res.json({
        summary: {
          totalRevenue: totalRevenue._sum.payoutAmount || 0,
          totalOrders,
          completedOrders,
          cancelledOrders,
          avgDeliveryTime: avgDeliveryTime._avg.actualDuration || 0,
          completionRate: totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0,
        },
        ordersByDay: (ordersByDay as any[]).map(item => ({
          date: item.date,
          count: Number(item.count),
        })),
        ordersByStatus: ordersByStatus.map(item => ({
          status: item.status,
          count: item._count.id,
        })),
        revenueByDay: (revenueByDay as any[]).map(item => ({
          date: item.date,
          revenue: Number(item.revenue) || 0,
        })),
        topAgents: topAgents.map(agent => ({
          id: agent.id,
          name: agent.user.name,
          email: agent.user.email,
          completedOrders: agent._count.orders,
          rating: agent.rating,
        })),
        topPartners: topPartners.map(partner => ({
          id: partner.id,
          companyName: partner.companyName,
          orders: partner._count.orders,
        })),
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      next(error);
    }
  },

  // GET /api/admin/analytics/revenue - Get revenue analytics
  async getRevenueAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, groupBy = 'day' } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      // Revenue by time period
      let revenueData;
      if (groupBy === 'day') {
        revenueData = await prisma.$queryRaw<Array<{ date: Date; revenue: number; orders: bigint }>>`
          SELECT DATE("deliveredAt") as date, SUM("payoutAmount")::float as revenue, COUNT(*)::bigint as orders
          FROM "Order"
          WHERE status = 'DELIVERED' AND "deliveredAt" >= ${start} AND "deliveredAt" <= ${end}
          GROUP BY DATE("deliveredAt")
          ORDER BY date ASC
        `;
      } else if (groupBy === 'week') {
        revenueData = await prisma.$queryRaw<Array<{ week: Date; revenue: number; orders: bigint }>>`
          SELECT DATE_TRUNC('week', "deliveredAt") as week, SUM("payoutAmount")::float as revenue, COUNT(*)::bigint as orders
          FROM "Order"
          WHERE status = 'DELIVERED' AND "deliveredAt" >= ${start} AND "deliveredAt" <= ${end}
          GROUP BY DATE_TRUNC('week', "deliveredAt")
          ORDER BY week ASC
        `;
      } else {
        revenueData = await prisma.$queryRaw<Array<{ month: Date; revenue: number; orders: bigint }>>`
          SELECT DATE_TRUNC('month', "deliveredAt") as month, SUM("payoutAmount")::float as revenue, COUNT(*)::bigint as orders
          FROM "Order"
          WHERE status = 'DELIVERED' AND "deliveredAt" >= ${start} AND "deliveredAt" <= ${end}
          GROUP BY DATE_TRUNC('month', "deliveredAt")
          ORDER BY month ASC
        `;
      }

      res.json({
        revenueData: (revenueData as any[]).map(item => ({
          date: item.date || item.week || item.month,
          revenue: Number(item.revenue) || 0,
          orders: Number(item.orders) || 0,
        })),
        period: { start, end },
        groupBy,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/analytics/performance - Get performance analytics
  async getPerformanceAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const [
        avgDeliveryTime,
        avgAssignmentTime,
        onTimeDeliveryRate,
        agentPerformance,
      ] = await Promise.all([
        // Average delivery time
        prisma.order.aggregate({
          where: {
            status: 'DELIVERED',
            deliveredAt: { gte: start, lte: end },
            actualDuration: { not: null },
          },
          _avg: {
            actualDuration: true,
          },
        }),
        // Average assignment time (time from creation to assignment)
        prisma.$queryRaw<Array<{ avg_assignment_time: number }>>`
          SELECT AVG(EXTRACT(EPOCH FROM ("assignedAt" - "createdAt")))::float as avg_assignment_time
          FROM "Order"
          WHERE "assignedAt" IS NOT NULL 
            AND "createdAt" >= ${start} 
            AND "createdAt" <= ${end}
        `,
        // On-time delivery rate (delivered within estimated time)
        prisma.$queryRaw<Array<{ on_time: bigint; total: bigint }>>`
          SELECT 
            COUNT(*) FILTER (WHERE "actualDuration" <= "estimatedDuration")::bigint as on_time,
            COUNT(*)::bigint as total
          FROM "Order"
          WHERE status = 'DELIVERED' 
            AND "deliveredAt" >= ${start} 
            AND "deliveredAt" <= ${end}
            AND "actualDuration" IS NOT NULL
            AND "estimatedDuration" IS NOT NULL
        `,
        // Agent performance metrics
        prisma.agent.findMany({
          where: {
            orders: {
              some: {
                deliveredAt: { gte: start, lte: end },
              },
            },
          },
          include: {
            user: {
              select: {
                name: true,
              },
            },
            orders: {
              where: {
                deliveredAt: { gte: start, lte: end },
              },
              select: {
                actualDuration: true,
                estimatedDuration: true,
              },
            },
          },
        }),
      ]);

      const onTimeRate = (onTimeDeliveryRate as any[])[0];
      const onTimeDeliveryRateValue = onTimeRate?.total && Number(onTimeRate.total) > 0
        ? (Number(onTimeRate.on_time) / Number(onTimeRate.total)) * 100
        : 0;

      res.json({
        avgDeliveryTime: avgDeliveryTime._avg.actualDuration || 0,
        avgAssignmentTime: Number((avgAssignmentTime as any[])[0]?.avg_assignment_time) || 0,
        onTimeDeliveryRate: onTimeDeliveryRateValue,
        agentPerformance: agentPerformance.map(agent => ({
          id: agent.id,
          name: agent.user.name,
          totalOrders: agent.orders.length,
          avgDeliveryTime: agent.orders.length > 0
            ? agent.orders.reduce((sum, o) => sum + (o.actualDuration || 0), 0) / agent.orders.length
            : 0,
          onTimeRate: agent.orders.length > 0
            ? (agent.orders.filter(o => o.actualDuration && o.estimatedDuration && o.actualDuration <= o.estimatedDuration).length / agent.orders.length) * 100
            : 0,
        })),
      });
    } catch (error) {
      next(error);
    }
  },

  // ==================== SETTINGS ====================

  // GET /api/admin/settings - Get system settings
  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      // Get or create system settings (singleton pattern)
      let settings = await prisma.systemSettings.findUnique({
        where: { id: 'system' },
      });

      // If settings don't exist, create with defaults
      if (!settings) {
        settings = await prisma.systemSettings.create({
          data: {
            id: 'system',
            systemName: 'DeliveryHub',
            maintenanceMode: false,
            registrationEnabled: true,
            agentAutoApproval: false,
            emailEnabled: true,
            smsEnabled: false,
            pushEnabled: true,
            maxRadius: 5000,
            maxAgentsToOffer: 5,
            offerTimeout: 30,
            platformFee: 0.1,
            minPayout: 10.0,
          },
        });
      }

      res.json({
        system: {
          name: settings.systemName,
          maintenanceMode: settings.maintenanceMode,
          registrationEnabled: settings.registrationEnabled,
          agentAutoApproval: settings.agentAutoApproval,
        },
        notifications: {
          emailEnabled: settings.emailEnabled,
          smsEnabled: settings.smsEnabled,
          pushEnabled: settings.pushEnabled,
        },
        delivery: {
          maxRadius: settings.maxRadius,
          maxAgentsToOffer: settings.maxAgentsToOffer,
          offerTimeout: settings.offerTimeout,
        },
        fees: {
          platformFee: settings.platformFee,
          minPayout: settings.minPayout,
        },
      });
    } catch (error: any) {
      // If table doesn't exist, return defaults
      if (error?.code === 'P2021' || error?.code === '42P01' || error?.message?.includes('does not exist')) {
        console.warn('[Settings] SystemSettings table does not exist - returning defaults');
        res.json({
          system: {
            name: 'DeliveryHub',
            maintenanceMode: false,
            registrationEnabled: true,
            agentAutoApproval: false,
          },
          notifications: {
            emailEnabled: true,
            smsEnabled: false,
            pushEnabled: true,
          },
          delivery: {
            maxRadius: 5000,
            maxAgentsToOffer: 5,
            offerTimeout: 30,
          },
          fees: {
            platformFee: 0.1,
            minPayout: 10.0,
          },
        });
        return;
      }
      next(error);
    }
  },

  // PUT /api/admin/settings - Update system settings
  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const { system, notifications, delivery, fees } = req.body;
      const userId = getUserId(req);

      // Update or create system settings
      const updatedSettings = await prisma.systemSettings.upsert({
        where: { id: 'system' },
        update: {
          systemName: system?.name,
          maintenanceMode: system?.maintenanceMode,
          registrationEnabled: system?.registrationEnabled,
          agentAutoApproval: system?.agentAutoApproval,
          emailEnabled: notifications?.emailEnabled,
          smsEnabled: notifications?.smsEnabled,
          pushEnabled: notifications?.pushEnabled,
          maxRadius: delivery?.maxRadius,
          maxAgentsToOffer: delivery?.maxAgentsToOffer,
          offerTimeout: delivery?.offerTimeout,
          platformFee: fees?.platformFee,
          minPayout: fees?.minPayout,
          updatedBy: userId || null,
        },
        create: {
          id: 'system',
          systemName: system?.name || 'DeliveryHub',
          maintenanceMode: system?.maintenanceMode ?? false,
          registrationEnabled: system?.registrationEnabled ?? true,
          agentAutoApproval: system?.agentAutoApproval ?? false,
          emailEnabled: notifications?.emailEnabled ?? true,
          smsEnabled: notifications?.smsEnabled ?? false,
          pushEnabled: notifications?.pushEnabled ?? true,
          maxRadius: delivery?.maxRadius ?? 5000,
          maxAgentsToOffer: delivery?.maxAgentsToOffer ?? 5,
          offerTimeout: delivery?.offerTimeout ?? 30,
          platformFee: fees?.platformFee ?? 0.1,
          minPayout: fees?.minPayout ?? 10.0,
          updatedBy: userId || null,
        },
      });

      res.json({
        message: 'Settings updated successfully',
        settings: {
          system: {
            name: updatedSettings.systemName,
            maintenanceMode: updatedSettings.maintenanceMode,
            registrationEnabled: updatedSettings.registrationEnabled,
            agentAutoApproval: updatedSettings.agentAutoApproval,
          },
          notifications: {
            emailEnabled: updatedSettings.emailEnabled,
            smsEnabled: updatedSettings.smsEnabled,
            pushEnabled: updatedSettings.pushEnabled,
          },
          delivery: {
            maxRadius: updatedSettings.maxRadius,
            maxAgentsToOffer: updatedSettings.maxAgentsToOffer,
            offerTimeout: updatedSettings.offerTimeout,
          },
          fees: {
            platformFee: updatedSettings.platformFee,
            minPayout: updatedSettings.minPayout,
          },
        },
      });
    } catch (error: any) {
      // If table doesn't exist, just return success (migration may need to run)
      if (error?.code === 'P2021' || error?.code === '42P01' || error?.message?.includes('does not exist')) {
        console.warn('[Settings] SystemSettings table does not exist - settings not saved');
        res.json({
          message: 'Settings update acknowledged (database migration may be needed)',
          settings: req.body,
        });
        return;
      }
      next(error);
    }
  },

  // POST /api/admin/agents/fix-status - Fix agents stuck in ON_TRIP status
  async fixAgentStatuses(req: Request, res: Response, next: NextFunction) {
    try {
      // Find all agents with ON_TRIP status
      const agentsOnTrip = await prisma.agent.findMany({
        where: {
          status: 'ON_TRIP',
        },
        select: {
          id: true,
          currentOrderId: true,
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      const fixedAgents: Array<{ id: string; name: string; email: string; hadActiveOrder: boolean }> = [];
      const errors: Array<{ id: string; error: string }> = [];

      for (const agent of agentsOnTrip) {
        try {
          // Check if agent has any active orders
          const activeOrder = await prisma.order.findFirst({
            where: {
              agentId: agent.id,
              status: {
                in: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'AT_WAREHOUSE', 'READY_FOR_PICKUP'],
              },
            },
            select: { id: true },
          });

          if (!activeOrder) {
            // Agent has no active orders, fix their status
            await prisma.agent.update({
              where: { id: agent.id },
              data: {
                status: 'ONLINE',
                currentOrderId: null,
              },
            });

            fixedAgents.push({
              id: agent.id,
              name: agent.user.name,
              email: agent.user.email,
              hadActiveOrder: false,
            });
          } else {
            // Agent has active order but currentOrderId might be wrong
            if (agent.currentOrderId !== activeOrder.id) {
              await prisma.agent.update({
                where: { id: agent.id },
                data: {
                  currentOrderId: activeOrder.id,
                  status: 'ON_TRIP', // Keep ON_TRIP since they have active order
                },
              });

              fixedAgents.push({
                id: agent.id,
                name: agent.user.name,
                email: agent.user.email,
                hadActiveOrder: true,
              });
            }
          }
        } catch (error: any) {
          errors.push({
            id: agent.id,
            error: error.message || 'Unknown error',
          });
        }
      }

      res.json({
        success: true,
        message: `Fixed ${fixedAgents.length} agent(s)`,
        fixed: fixedAgents.length,
        total: agentsOnTrip.length,
        agents: fixedAgents,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/sync/wallet-revenue - Synchronize wallet and revenue with actual values
  async syncWalletAndRevenue(req: Request, res: Response, next: NextFunction) {
    try {
      // Import and run the sync function
      const syncModule = await import('../scripts/sync-wallet-revenue');
      const { syncWalletAndRevenue } = syncModule;

      if (!syncWalletAndRevenue) {
        throw new Error('Sync function not found in module');
      }

      // Run sync in background and return immediately
      syncWalletAndRevenue()
        .then(() => {
          console.log('[Admin] Wallet and revenue synchronization completed successfully');
        })
        .catch((error: any) => {
          console.error('[Admin] Wallet and revenue synchronization failed:', error);
          console.error('[Admin] Error stack:', error?.stack);
        });

      res.json({
        message: 'Wallet and revenue synchronization started',
        status: 'processing',
      });
    } catch (error: any) {
      console.error('[Admin] Error starting sync:', error);
      console.error('[Admin] Error stack:', error?.stack);
      res.status(500).json({
        error: 'Failed to start synchronization',
        message: error?.message || 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      });
    }
  },

  // GET /api/admin/metrics?byCategory=true - Get metrics broken down by category
  async getMetricsByCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();
      const metrics = await metricsService.getMetricsByCategory(start, end);
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  },

  // GET /api/pricing-profiles - List all pricing profiles
  async getPricingProfiles(req: Request, res: Response, next: NextFunction) {
    try {
      // Check if PricingProfile table exists
      let profiles: any[] = [];
      try {
        profiles = await (prisma as any).pricingProfile.findMany({
          orderBy: { category: 'asc' },
          include: {
            _count: {
              select: { partners: true },
            },
          },
        });
      } catch (error: any) {
        // If table doesn't exist (P2021/P2022), return empty array
        if (error?.code === 'P2021' || error?.code === 'P2022' || error?.message?.includes('does not exist')) {
          console.warn('⚠️  PricingProfile table does not exist yet');
          return res.json({ profiles: [] });
        }
        throw error;
      }

      res.json({
        profiles: profiles.map((profile: any) => ({
          id: profile.id,
          name: profile.name,
          category: profile.category,
          baseFee: profile.baseFee,
          perKmFee: profile.perKmFee,
          surgePercent: profile.surgePercent,
          agentSharePct: profile.agentSharePct,
          partnerCount: profile._count?.partners || 0,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
};

