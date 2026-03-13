/**
 * SpawnRateLimiter — token bucket rate limiter for agent spawning.
 *
 * Each chatroom gets its own token bucket. By default:
 * - maxTokens: 5 (burst capacity)
 * - refillRateMs: 60_000 (1 token per minute)
 * - initialTokens: 5
 *
 * User-initiated spawn reasons (prefixed with "user.") always bypass the rate limit.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpawnRateLimiterConfig {
  /** Maximum number of tokens in the bucket. */
  maxTokens: number;
  /** Time in milliseconds to refill one token. */
  refillRateMs: number;
  /** Initial number of tokens. */
  initialTokens: number;
}

export interface TryConsumeResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export interface BucketStatus {
  remaining: number;
  total: number;
}

// ─── Token Bucket ─────────────────────────────────────────────────────────────

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SpawnRateLimiterConfig = {
  maxTokens: 5,
  refillRateMs: 60_000,
  initialTokens: 5,
};

const LOW_TOKEN_THRESHOLD = 1;

export class SpawnRateLimiter {
  private readonly config: SpawnRateLimiterConfig;
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(config: Partial<SpawnRateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Try to consume a token for the given chatroom.
   *
   * If the reason starts with "user." the spawn is always allowed (bypass).
   * Otherwise, checks the token bucket and consumes a token if available.
   */
  tryConsume(chatroomId: string, reason: string): TryConsumeResult {
    // User-initiated spawns always bypass rate limiting
    if (reason.startsWith('user.')) {
      return { allowed: true };
    }

    const bucket = this._getOrCreateBucket(chatroomId);
    this._refill(bucket);

    if (bucket.tokens < 1) {
      // Compute how long until the next token is available
      const elapsed = Date.now() - bucket.lastRefillAt;
      const retryAfterMs = this.config.refillRateMs - elapsed;

      console.warn(
        `⚠️ [RateLimiter] Agent spawn rate-limited for chatroom ${chatroomId} (reason: ${reason}). Retry after ${retryAfterMs}ms`
      );

      return { allowed: false, retryAfterMs };
    }

    // Consume one token
    bucket.tokens -= 1;

    const remaining = Math.floor(bucket.tokens);
    if (remaining <= LOW_TOKEN_THRESHOLD) {
      console.warn(
        `⚠️ [RateLimiter] Agent spawn tokens running low for chatroom ${chatroomId} (${remaining}/${this.config.maxTokens} remaining)`
      );
    }

    return { allowed: true };
  }

  /**
   * Get the current status of the token bucket for a chatroom.
   */
  getStatus(chatroomId: string): BucketStatus {
    const bucket = this._getOrCreateBucket(chatroomId);
    this._refill(bucket);
    return {
      remaining: Math.floor(bucket.tokens),
      total: this.config.maxTokens,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private _getOrCreateBucket(chatroomId: string): TokenBucket {
    if (!this.buckets.has(chatroomId)) {
      this.buckets.set(chatroomId, {
        tokens: this.config.initialTokens,
        lastRefillAt: Date.now(),
      });
    }
    return this.buckets.get(chatroomId)!;
  }

  private _refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefillAt;

    if (elapsed >= this.config.refillRateMs) {
      const tokensToAdd = Math.floor(elapsed / this.config.refillRateMs);
      bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + tokensToAdd);
      // Advance lastRefillAt by full refill intervals only
      bucket.lastRefillAt += tokensToAdd * this.config.refillRateMs;
    }
  }
}
