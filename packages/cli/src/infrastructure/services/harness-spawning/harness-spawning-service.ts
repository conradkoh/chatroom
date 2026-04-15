/**
 * HarnessSpawningService — wraps agent spawning with rate limiting and
 * concurrent agent tracking per chatroom.
 *
 * Responsibilities:
 * - Delegates rate-limit decisions to SpawnRateLimiter
 * - Enforces a hard cap on concurrent agents per chatroom
 * - Tracks active agent counts via recordSpawn / recordExit
 */

import type { SpawnRateLimiter, TryConsumeResult } from './rate-limiter.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CONCURRENT_AGENTS_PER_CHATROOM = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpawnOptions {
  bypassConcurrentLimit?: boolean;
}

export interface HarnessSpawningServiceDeps {
  rateLimiter: SpawnRateLimiter;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class HarnessSpawningService {
  private readonly rateLimiter: SpawnRateLimiter;
  private readonly concurrentAgents = new Map<string, number>();

  constructor({ rateLimiter }: HarnessSpawningServiceDeps) {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Check whether a new agent spawn should be allowed for the given chatroom.
   *
   * Enforces two gates (in order):
   * 1. Concurrent agent hard limit — if the chatroom already has
   *    MAX_CONCURRENT_AGENTS_PER_CHATROOM active agents, reject immediately.
   *    (Can be bypassed with options.bypassConcurrentLimit = true)
   * 2. Rate limiter — delegates to SpawnRateLimiter for token-bucket check.
   */
  shouldAllowSpawn(
    chatroomId: string,
    reason: string,
    options?: SpawnOptions
  ): TryConsumeResult {
    const current = this.concurrentAgents.get(chatroomId) ?? 0;

    // Skip concurrent limit check if bypass is requested (e.g., manual user actions)
    if (!options?.bypassConcurrentLimit && current >= MAX_CONCURRENT_AGENTS_PER_CHATROOM) {
      console.warn(
        `⚠️ [HarnessSpawningService] Concurrent agent limit reached for chatroom ${chatroomId} ` +
          `(${current}/${MAX_CONCURRENT_AGENTS_PER_CHATROOM} active agents). Spawn rejected.`
      );
      return { allowed: false };
    }

    const result = this.rateLimiter.tryConsume(chatroomId, reason);

    if (!result.allowed) {
      console.warn(
        `⚠️ [HarnessSpawningService] Spawn blocked by rate limiter for chatroom ${chatroomId} ` +
          `(reason: ${reason}).`
      );
    }

    return result;
  }

  /**
   * Record that a new agent has been successfully spawned for the given chatroom.
   * Increments the concurrent agent count.
   */
  recordSpawn(chatroomId: string): void {
    const current = this.concurrentAgents.get(chatroomId) ?? 0;
    this.concurrentAgents.set(chatroomId, current + 1);
  }

  /**
   * Record that an agent has exited for the given chatroom.
   * Decrements the concurrent agent count (floor at 0).
   */
  recordExit(chatroomId: string): void {
    const current = this.concurrentAgents.get(chatroomId) ?? 0;
    const next = Math.max(0, current - 1);
    this.concurrentAgents.set(chatroomId, next);
  }

  /**
   * Returns the current number of active (tracked) agents for a chatroom.
   * Useful for monitoring / debugging.
   */
  getConcurrentCount(chatroomId: string): number {
    return this.concurrentAgents.get(chatroomId) ?? 0;
  }
}
