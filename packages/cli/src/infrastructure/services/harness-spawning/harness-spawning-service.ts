/**
 * HarnessSpawningService — wraps agent spawning with rate limiting per chatroom.
 */

import type { SpawnRateLimiter, TryConsumeResult } from './rate-limiter.js';

export interface HarnessSpawningServiceDeps {
  rateLimiter: SpawnRateLimiter;
}

export class HarnessSpawningService {
  private readonly rateLimiter: SpawnRateLimiter;

  constructor({ rateLimiter }: HarnessSpawningServiceDeps) {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Check whether a new agent spawn should be allowed for the given chatroom.
   */
  shouldAllowSpawn(chatroomId: string, reason: string): TryConsumeResult {
    const result = this.rateLimiter.tryConsume(chatroomId, reason);

    if (!result.allowed) {
      console.warn(
        `⚠️ [HarnessSpawningService] Spawn blocked by rate limiter for chatroom ${chatroomId} ` +
          `(reason: ${reason}).`
      );
    }

    return result;
  }
}
