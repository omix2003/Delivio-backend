import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { getPartnerId } from '../utils/role.util';

export const ratingController = {
  // POST /api/ratings - Submit a rating for an agent
  async submitRating(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId, rating, comment } = req.body;
      const partnerId = getPartnerId(req);

      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can rate agents' });
      }

      if (!orderId || !rating) {
        return res.status(400).json({ error: 'Order ID and rating are required' });
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }

      // Verify order exists and belongs to this partner
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          agent: true,
          partner: true,
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      if (order.partnerId !== partnerId) {
        return res.status(403).json({ error: 'You can only rate agents for your own orders' });
      }

      if (order.status !== 'DELIVERED') {
        return res.status(400).json({ error: 'You can only rate agents for delivered orders' });
      }

      if (!order.agentId) {
        return res.status(400).json({ error: 'Order has no assigned agent' });
      }

      // Check if rating already exists
      let existingRating;
      try {
        existingRating = await prisma.agentRating.findUnique({
          where: { orderId },
        });
      } catch (dbError: any) {
        console.error('[Rating] Database error when checking existing rating:', {
          message: dbError?.message,
          code: dbError?.code,
          meta: dbError?.meta,
        });
        // If table doesn't exist, provide helpful error
        if (dbError?.code === 'P2021' || dbError?.message?.includes('does not exist')) {
          return res.status(500).json({
            error: 'Database migration required',
            message: 'The AgentRating table does not exist. Please run database migrations: npx prisma migrate deploy',
          });
        }
        throw dbError;
      }

      let ratingRecord;
      try {
        if (existingRating) {
          // Update existing rating
          ratingRecord = await prisma.agentRating.update({
            where: { id: existingRating.id },
            data: {
              rating,
              comment: comment || null,
            },
          });
        } else {
          // Create new rating
          ratingRecord = await prisma.agentRating.create({
            data: {
              orderId,
              agentId: order.agentId,
              partnerId,
              rating,
              comment: comment || null,
            },
          });
        }
      } catch (dbError: any) {
        console.error('[Rating] Database error when creating/updating rating:', {
          message: dbError?.message,
          code: dbError?.code,
          meta: dbError?.meta,
        });
        // If table doesn't exist, provide helpful error
        if (dbError?.code === 'P2021' || dbError?.message?.includes('does not exist')) {
          return res.status(500).json({
            error: 'Database migration required',
            message: 'The AgentRating table does not exist. Please run database migrations: npx prisma migrate deploy',
          });
        }
        throw dbError;
      }

      // Recalculate agent's average rating
      const ratings = await prisma.agentRating.findMany({
        where: { agentId: order.agentId },
        select: { rating: true },
      });

      const averageRating = ratings.length > 0
        ? ratings.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / ratings.length
        : 0;

      await prisma.agent.update({
        where: { id: order.agentId },
        data: { rating: averageRating },
      });

      res.json({
        message: 'Rating submitted successfully',
        rating: ratingRecord,
      });
    } catch (error: any) {
      console.error('[Rating] Error submitting rating:', {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        meta: error?.meta,
      });
      next(error);
    }
  },

  // GET /api/ratings/agent/:agentId - Get all ratings for an agent
  async getAgentRatings(req: Request, res: Response, next: NextFunction) {
    try {
      const { agentId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const skip = (Number(page) - 1) * Number(limit);

      try {
        const [ratings, total] = await Promise.all([
          prisma.agentRating.findMany({
            where: { agentId },
            select: {
              id: true,
              orderId: true,
              agentId: true,
              partnerId: true,
              rating: true,
              comment: true,
              createdAt: true,
              partner: {
                select: {
                  id: true,
                  companyName: true,
                  user: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
              order: {
                select: {
                  id: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: Number(limit),
          }).catch((err: any) => {
            if (err?.code === 'P2021' || err?.code === 'P2022' || err?.code === '42P01' || err?.message?.includes('does not exist')) {
              return [];
            }
            throw err;
          }),
          prisma.agentRating.count({
            where: { agentId },
          }).catch((err: any) => {
            if (err?.code === 'P2021' || err?.code === 'P2022' || err?.code === '42P01' || err?.message?.includes('does not exist')) {
              return 0;
            }
            throw err;
          }),
        ]);

        res.json({
          ratings,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return empty results
        if (error?.code === 'P2021' || error?.code === 'P2022' || error?.code === '42P01' || error?.message?.includes('does not exist')) {
          console.warn('⚠️  AgentRating table does not exist - returning empty results');
          return res.json({
            ratings: [],
            pagination: {
              page: Number(page),
              limit: Number(limit),
              total: 0,
              totalPages: 0,
            },
          });
        }
        throw error;
      }
    } catch (error: any) {
      console.error('[Rating] Error fetching agent ratings:', {
        message: error?.message,
        code: error?.code,
        meta: error?.meta,
        stack: error?.stack,
        agentId: req.params.agentId,
      });
      next(error);
    }
  },

  // GET /api/ratings/order/:orderId - Get rating for a specific order
  async getOrderRating(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;

      const rating = await prisma.agentRating.findUnique({
        where: { orderId },
        include: {
          partner: {
            select: {
              id: true,
              companyName: true,
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!rating) {
        return res.status(404).json({ error: 'Rating not found' });
      }

      res.json({ rating });
    } catch (error) {
      next(error);
    }
  },
};

