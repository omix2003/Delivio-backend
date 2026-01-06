import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Redis client singleton
let redis: Redis | null = null;
let isRedisAvailable = false;
let lastErrorTime = 0;
const ERROR_THROTTLE_MS = 10000; // Only log errors every 10 seconds

// Check if Redis is explicitly disabled
const isRedisDisabled = process.env.REDIS_ENABLED === 'false';

export const getRedisClient = (): Redis | null => {
  // If Redis is explicitly disabled, return null immediately
  if (isRedisDisabled) {
    return null;
  }

  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redis = new Redis(redisUrl, {
      retryStrategy: (times) => {
        // Exponential backoff with max delay of 5 seconds
        // Continue retrying indefinitely but with increasing delays
        const delay = Math.min(times * 100, 5000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      lazyConnect: true, // Don't connect immediately
      enableOfflineQueue: false, // Don't queue commands when offline
      reconnectOnError: (err: Error) => {
        // Reconnect on connection errors
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true; // Reconnect
        }
        // Don't reconnect on other errors
        return false;
      },
    });

    redis.on('error', (err: Error) => {
      isRedisAvailable = false;
      
      // Suppress common connection errors in development
      const isConnectionError = 
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('EPERM') ||
        err.message.includes('connect') ||
        err.message.includes('ENOTFOUND');
      
      // Only log non-connection errors or throttle connection errors
      const now = Date.now();
      if (!isConnectionError || (now - lastErrorTime > ERROR_THROTTLE_MS)) {
        if (!isConnectionError) {
          console.error('Redis Client Error:', err.message);
        }
        lastErrorTime = now;
      }
    });

    redis.on('connect', () => {
      console.log('✅ Redis Client Connected');
      isRedisAvailable = true;
      lastErrorTime = 0; // Reset error throttle on successful connection
    });

    redis.on('ready', () => {
      isRedisAvailable = true;
    });

    redis.on('close', () => {
      isRedisAvailable = false;
    });

    redis.on('reconnecting', () => {
      // Redis is attempting to reconnect
      isRedisAvailable = false;
    });

    redis.on('end', () => {
      // Connection ended, reset availability
      isRedisAvailable = false;
    });

    // Attempt to connect, but don't fail if it doesn't
    redis.connect().catch((err: Error) => {
      // Connection failed, but we'll continue without Redis
      // Only log once, suppress common errors
      const isCommonError = 
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('EPERM') ||
        err.message.includes('connect');
      
      if (!isCommonError) {
        console.warn('⚠️  Redis connection failed:', err.message);
      }
      // Silently continue without Redis in development
    });
  }

  return redis;
};

export const isRedisConnected = (): boolean => {
  if (!redis) return false;
  // Check if Redis is in a ready state
  const status = redis.status;
  return isRedisAvailable && (status === 'ready' || status === 'connect');
};

// Test Redis connection with a ping
export const testRedisConnection = async (): Promise<boolean> => {
  try {
    const client = getRedisClient();
    if (!client) return false;
    
    const result = await Promise.race([
      client.ping(),
      new Promise<null>((_, reject) => 
        setTimeout(() => reject(new Error('Redis ping timeout')), 2000)
      ),
    ]);
    
    return result === 'PONG';
  } catch (error) {
    return false;
  }
};

// Get Redis connection status info
export const getRedisStatus = () => {
  if (!redis) {
    return {
      connected: false,
      status: 'not_initialized',
      message: 'Redis client not initialized',
    };
  }
  
  return {
    connected: isRedisConnected(),
    status: redis.status,
    message: isRedisConnected()
      ? 'Redis is connected and ready'
      : 'Redis is not connected',
  };
};

// Helper functions for Redis GEO operations
export const redisGeo = {
  // Add agent location to Redis GEO
  addAgentLocation: async (agentId: string, longitude: number, latitude: number) => {
    if (!isRedisConnected()) {
      console.warn('Redis not available, skipping addAgentLocation');
      return null;
    }
    try {
      const client = getRedisClient();
      if (!client) return null;
      return await client.geoadd('agents_locations', longitude, latitude, agentId);
    } catch (error) {
      console.error('Error adding agent location to Redis:', error);
      return null;
    }
  },

  // Get nearby agents within radius (in meters)
  // Returns array that can be flat [agentId, distance, ...] or nested [[agentId, distance], ...]
  getNearbyAgents: async (
    longitude: number,
    latitude: number,
    radius: number = 5000, // 5km default
    unit: 'm' | 'km' | 'mi' | 'ft' = 'm'
  ): Promise<unknown[]> => {
    if (!isRedisConnected()) {
      console.warn('Redis not available, returning empty array for getNearbyAgents');
      return [];
    }
    try {
      const client = getRedisClient();
      if (!client) return [];
      const result = await client.georadius(
        'agents_locations',
        longitude,
        latitude,
        radius,
        unit,
        'WITHCOORD',
        'WITHDIST',
        'ASC'
      );
      return (result as unknown[]) || [];
    } catch (error) {
      console.error('Error getting nearby agents from Redis:', error);
      return [];
    }
  },

  // Remove agent location
  removeAgentLocation: async (agentId: string) => {
    if (!isRedisConnected()) {
      console.warn('Redis not available, skipping removeAgentLocation');
      return null;
    }
    try {
      const client = getRedisClient();
      if (!client) return null;
      return await client.zrem('agents_locations', agentId);
    } catch (error) {
      console.error('Error removing agent location from Redis:', error);
      return null;
    }
  },

  // Get all agent locations
  getAllAgentLocations: async () => {
    if (!isRedisConnected()) {
      console.warn('Redis not available, returning empty array for getAllAgentLocations');
      return [];
    }
    try {
      const client = getRedisClient();
      if (!client) return [];
      return await client.zrange('agents_locations', 0, -1, 'WITHSCORES');
    } catch (error) {
      console.error('Error getting all agent locations from Redis:', error);
      return [];
    }
  },
};

export default getRedisClient;




