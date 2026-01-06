import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';

let io: SocketIOServer | null = null;

interface JWTPayload {
  id: string;
  email: string;
  role: string;
  agentId?: string;
  partnerId?: string;
}

/**
 * Initialize WebSocket server
 */
export function initializeWebSocket(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
    },
    path: '/socket.io',
  });

  // Authentication middleware for WebSocket
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify JWT token
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'djfhfudfhcnuyedufcy5482dfdf'
      ) as JWTPayload;

      socket.data.user = decoded;
      socket.data.token = token;
      
      // If agent, store agentId
      if (decoded.agentId) {
        socket.data.agentId = decoded.agentId;
      }
      
      // If partner, store partnerId
      if (decoded.partnerId) {
        socket.data.partnerId = decoded.partnerId;
      }

      next();
    } catch (error: any) {
      if (error instanceof jwt.JsonWebTokenError) {
        return next(new Error('Invalid token'));
      }
      if (error instanceof jwt.TokenExpiredError) {
        return next(new Error('Token expired'));
      }
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const user = socket.data.user as JWTPayload;
    console.log(`[WebSocket] Client connected: ${socket.id} (User: ${user.email}, Role: ${user.role})`);

    // Join role-specific rooms
    if (socket.data.agentId) {
      socket.join(`agent:${socket.data.agentId}`);
      console.log(`[WebSocket] Agent ${socket.data.agentId} joined agent room`);
    }
    
    if (socket.data.partnerId) {
      socket.join(`partner:${socket.data.partnerId}`);
      console.log(`[WebSocket] Partner ${socket.data.partnerId} joined partner room`);
    }

    // Handle agent online status
    socket.on('agent:online', async () => {
      const agentId = socket.data.agentId;
      if (agentId) {
        socket.join(`agent:${agentId}`);
        console.log(`[WebSocket] Agent ${agentId} marked as online`);
      }
    });

    // Handle agent offline status
    socket.on('agent:offline', async () => {
      const agentId = socket.data.agentId;
      if (agentId) {
        socket.leave(`agent:${agentId}`);
        console.log(`[WebSocket] Agent ${agentId} marked as offline`);
      }
    });

    // Handle order acceptance
    socket.on('order:accept', async (data: { orderId: string }) => {
      const agentId = socket.data.agentId;
      if (!agentId) {
        socket.emit('error', { message: 'Agent not authenticated' });
        return;
      }

      // The actual acceptance logic is handled by the API endpoint
      // This is just for real-time updates
      console.log(`[WebSocket] Agent ${agentId} accepting order ${data.orderId}`);
    });

    // Handle order rejection
    socket.on('order:reject', async (data: { orderId: string }) => {
      const agentId = socket.data.agentId;
      if (!agentId) {
        socket.emit('error', { message: 'Agent not authenticated' });
        return;
      }

      console.log(`[WebSocket] Agent ${agentId} rejecting order ${data.orderId}`);
    });

    // Handle agent location updates via WebSocket (more efficient than HTTP)
    socket.on('agent:location-update', async (data: { latitude: number; longitude: number }) => {
      const agentId = socket.data.agentId;
      if (!agentId) {
        socket.emit('error', { message: 'Agent not authenticated' });
        return;
      }

      try {
        // Import here to avoid circular dependencies
        const { redisGeo } = await import('./redis');
        const { locationUpdateQueue } = await import('../services/location-queue.service');
        
        // WRITE-BACK CACHE PATTERN:
        // 1. Write to Redis immediately (in-memory cache for fast queries)
        await redisGeo.addAgentLocation(agentId, data.longitude, data.latitude);

        // 2. Queue async database write (write-back pattern)
        const userId = user.id; // Use user from socket data
        locationUpdateQueue.enqueue({
          agentId,
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp: new Date(),
          userId: userId ?? undefined,
        });

        // 3. Broadcast location update to partners who have orders assigned to this agent
        try {
          const activeOrders = await prisma.order.findMany({
            where: {
              agentId,
              status: {
                in: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'IN_TRANSIT'],
              },
            },
            select: {
              id: true,
              partnerId: true,
            },
          });

          // Emit to each partner who has an active order with this agent
          for (const order of activeOrders) {
            io?.to(`partner:${order.partnerId}`).emit('agent:location-update', {
              agentId,
              orderId: order.id,
              latitude: data.latitude,
              longitude: data.longitude,
            });
          }
        } catch (broadcastError) {
          // Don't fail location update if broadcast fails
          console.warn(`[WebSocket] Failed to broadcast location to partners:`, broadcastError);
        }

        // Acknowledge receipt (optional - for reliability)
        socket.emit('agent:location-updated', { success: true });
      } catch (error: any) {
        console.error(`[WebSocket] Error updating location for agent ${agentId}:`, error);
        socket.emit('error', { message: 'Failed to update location' });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      const agentId = socket.data.agentId;
      console.log(`[WebSocket] Client disconnected: ${socket.id}${agentId ? ` (Agent: ${agentId})` : ''}`);
    });
  });

  return io;
}

/**
 * Get WebSocket server instance
 */
export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * Send order offer to agent via WebSocket
 */
export async function sendOrderOfferToAgent(agentId: string, orderData: any): Promise<void> {
  if (!io) {
    console.warn('[WebSocket] Server not initialized, cannot send order offer');
    return;
  }

  io.to(`agent:${agentId}`).emit('order:offer', {
    order: orderData,
    timestamp: new Date().toISOString(),
  });

  console.log(`[WebSocket] Order offer sent to agent ${agentId}`);
}

/**
 * Broadcast order assignment to partner
 */
export async function notifyPartnerOrderAssigned(partnerId: string, orderData: any): Promise<void> {
  if (!io) {
    return;
  }

  io.to(`partner:${partnerId}`).emit('order:assigned', {
    order: orderData,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Notify partner about order status update
 */
export async function notifyPartnerOrderStatusUpdate(partnerId: string, orderData: any): Promise<void> {
  if (!io) {
    console.warn('[WebSocket] Server not initialized, cannot send order status update');
    return;
  }

  io.to(`partner:${partnerId}`).emit('order:status-updated', {
    order: orderData,
    timestamp: new Date().toISOString(),
  });

  console.log(`[WebSocket] Order status update sent to partner ${partnerId} for order ${orderData.id}`);
}

/**
 * Notify agent about order status update
 */
export async function notifyAgentOrderStatusUpdate(agentId: string, orderData: any): Promise<void> {
  if (!io) {
    console.warn('[WebSocket] Server not initialized, cannot send order status update to agent');
    return;
  }

  io.to(`agent:${agentId}`).emit('order:status-updated', {
    order: orderData,
    timestamp: new Date().toISOString(),
  });

  console.log(`[WebSocket] Order status update sent to agent ${agentId} for order ${orderData.id}`);
}


