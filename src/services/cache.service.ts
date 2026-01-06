import { getRedisClient, isRedisConnected } from '../lib/redis';

const DEFAULT_TTL = 300; // 5 minutes default TTL

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string; // Key prefix
}

/**
 * Cache service for frequently accessed data
 * Uses Redis for caching with automatic fallback if Redis is unavailable
 */
export const cacheService = {
  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) return null;

    try {
      const value = await redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error: any) {
      // Only log if it's not a connection error (connection errors are expected when Redis is down)
      if (error?.message && !error.message.includes('Connection is closed') && !error.message.includes('ECONNREFUSED')) {
        console.error('[Cache] Error getting key:', key, error.message);
      }
      return null;
    }
  },

  /**
   * Set cached value
   */
  async set(key: string, value: any, ttl: number = DEFAULT_TTL): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) return false;

    try {
      await redis.setex(key, ttl, JSON.stringify(value));
      return true;
    } catch (error: any) {
      // Only log if it's not a connection error (connection errors are expected when Redis is down)
      if (error?.message && !error.message.includes('Connection is closed') && !error.message.includes('ECONNREFUSED')) {
        console.error('[Cache] Error setting key:', key, error.message);
      }
      return false;
    }
  },

  /**
   * Delete cached value
   */
  async del(key: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) return false;

    try {
      await redis.del(key);
      return true;
    } catch (error: any) {
      // Only log if it's not a connection error
      if (error?.message && !error.message.includes('Connection is closed') && !error.message.includes('ECONNREFUSED')) {
        console.error('[Cache] Error deleting key:', key, error.message);
      }
      return false;
    }
  },

  /**
   * Delete multiple keys matching pattern
   */
  async delPattern(pattern: string): Promise<number> {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) return 0;

    try {
      const keys = await redis.keys(pattern);
      if (keys.length === 0) return 0;
      await redis.del(...keys);
      return keys.length;
    } catch (error: any) {
      // Only log if it's not a connection error
      if (error?.message && !error.message.includes('Connection is closed') && !error.message.includes('ECONNREFUSED')) {
        console.error('[Cache] Error deleting pattern:', pattern, error.message);
      }
      return 0;
    }
  },

  /**
   * Get or set cached value (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = DEFAULT_TTL
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const fresh = await fetchFn();

    // Cache it (don't await - fire and forget)
    this.set(key, fresh, ttl).catch((err) => {
      console.error('[Cache] Error caching value:', err);
    });

    return fresh;
  },

  /**
   * Invalidate cache for a key
   */
  async invalidate(key: string): Promise<void> {
    await this.del(key);
  },

  /**
   * Invalidate cache for a pattern (e.g., all partner data)
   */
  async invalidatePattern(pattern: string): Promise<void> {
    await this.delPattern(pattern);
  },
};

/**
 * Cache key generators
 */
export const cacheKeys = {
  partner: {
    profile: (partnerId: string) => `partner:profile:${partnerId}`,
    orders: (partnerId: string, status?: string) => 
      `partner:orders:${partnerId}${status ? `:${status}` : ''}`,
    analytics: (partnerId: string, startDate: string, endDate: string) =>
      `partner:analytics:${partnerId}:${startDate}:${endDate}`,
    dashboard: (partnerId: string) => `partner:dashboard:${partnerId}`,
  },
  agent: {
    profile: (agentId: string) => `agent:profile:${agentId}`,
    orders: (agentId: string, status?: string) =>
      `agent:orders:${agentId}${status ? `:${status}` : ''}`,
  },
  admin: {
    metrics: (type: string, startDate?: string, endDate?: string) =>
      `admin:metrics:${type}${startDate ? `:${startDate}` : ''}${endDate ? `:${endDate}` : ''}`,
    agents: (filters?: string) => `admin:agents${filters ? `:${filters}` : ''}`,
    orders: (filters?: string) => `admin:orders${filters ? `:${filters}` : ''}`,
  },
};

















