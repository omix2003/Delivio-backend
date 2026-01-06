/**
 * Location Update Queue Service
 * Implements write-back cache pattern: writes to Redis immediately, queues DB writes
 */

import { prisma } from '../lib/prisma';
import { EventType } from '@prisma/client';
import { eventService } from './event.service';

interface LocationUpdateJob {
  agentId: string;
  latitude: number;
  longitude: number;
  timestamp: Date;
  userId?: string;
}

class LocationUpdateQueue {
  private queue: LocationUpdateJob[] = [];
  private processing = false;
  private batchSize = 10;
  private intervalMs = 2000; // Process every 2 seconds
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.startProcessor();
  }

  /**
   * Add location update to queue (write-back pattern)
   */
  enqueue(job: LocationUpdateJob): void {
    // Remove any existing pending update for this agent (deduplication)
    this.queue = this.queue.filter(j => j.agentId !== job.agentId);
    
    // Add new update
    this.queue.push(job);
    
    // If queue is getting large, process immediately
    if (this.queue.length >= this.batchSize * 2) {
      this.processBatch();
    }
  }

  /**
   * Start background processor
   */
  private startProcessor(): void {
    if (this.intervalId) return;
    
    this.intervalId = setInterval(() => {
      if (this.queue.length > 0 && !this.processing) {
        this.processBatch();
      }
    }, this.intervalMs);
  }

  /**
   * Process a batch of location updates
   */
  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    try {
      // Take up to batchSize jobs
      const batch = this.queue.splice(0, this.batchSize);
      
      if (batch.length === 0) {
        this.processing = false;
        return;
      }

      // Process in parallel with error handling
      const promises = batch.map(job => this.processJob(job));
      await Promise.allSettled(promises);
      
    } catch (error) {
      console.error('[LocationQueue] Error processing batch:', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single location update job
   */
  private async processJob(job: LocationUpdateJob): Promise<void> {
    try {
      // Write to database
      await prisma.agentLocation.create({
        data: {
          agentId: job.agentId,
          latitude: job.latitude,
          longitude: job.longitude,
          timestamp: job.timestamp,
        },
      });

      // Update lastOnlineAt timestamp (throttled - only update every 30 seconds)
      const now = Date.now();
      const lastUpdate = await prisma.agent.findUnique({
        where: { id: job.agentId },
        select: { lastOnlineAt: true },
      });

      const shouldUpdateTimestamp = !lastUpdate?.lastOnlineAt || 
        (now - lastUpdate.lastOnlineAt.getTime()) > 30000; // 30 seconds

      if (shouldUpdateTimestamp) {
        await prisma.agent.update({
          where: { id: job.agentId },
          data: { lastOnlineAt: new Date() },
        });
      }

      // Log event (throttled - only log every 30 seconds)
      if (job.userId && shouldUpdateTimestamp) {
        eventService.logAgentEvent(
          EventType.AGENT_LOCATION_UPDATE,
          job.agentId,
          job.userId,
          {
            latitude: job.latitude,
            longitude: job.longitude,
          }
        );
      }

    } catch (error: any) {
      // If job fails, re-queue it (with limit to prevent infinite loops)
      console.error(`[LocationQueue] Failed to process location update for agent ${job.agentId}:`, error.message);
      
      // Re-queue with exponential backoff (simple version - just add to end)
      // In production, you'd want proper retry logic with max retries
      if (this.queue.length < 1000) { // Prevent queue from growing too large
        this.queue.push(job);
      }
    }
  }

  /**
   * Get queue stats
   */
  getStats(): { queueLength: number; processing: boolean } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
    };
  }

  /**
   * Stop processor (for testing/cleanup)
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Flush all pending updates (for testing)
   */
  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      await this.processBatch();
      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// Export singleton instance
export const locationUpdateQueue = new LocationUpdateQueue();

