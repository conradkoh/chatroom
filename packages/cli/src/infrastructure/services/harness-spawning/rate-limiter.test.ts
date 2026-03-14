import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpawnRateLimiter } from './rate-limiter.js';

describe('SpawnRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── Token Bucket Depletion ────────────────────────────────────────────────

  describe('token bucket depletion', () => {
    it('allows spawns up to maxTokens and then rejects', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 3, initialTokens: 3, refillRateMs: 60_000 });
      const chatroomId = 'room-1';
      const reason = 'platform.crash_recovery';

      // Consume all 3 tokens
      expect(limiter.tryConsume(chatroomId, reason)).toEqual({ allowed: true });
      expect(limiter.tryConsume(chatroomId, reason)).toEqual({ allowed: true });
      expect(limiter.tryConsume(chatroomId, reason)).toEqual({ allowed: true });

      // 4th should be rejected
      const result = limiter.tryConsume(chatroomId, reason);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('rejects subsequent calls when tokens are exhausted', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 1, initialTokens: 1, refillRateMs: 60_000 });
      limiter.tryConsume('room-A', 'platform.crash_recovery');

      const result = limiter.tryConsume('room-A', 'platform.crash_recovery');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── User-Initiated Bypass ────────────────────────────────────────────────

  describe('user-initiated bypass', () => {
    it('always allows spawns with a reason starting with "user."', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 0, initialTokens: 0, refillRateMs: 60_000 });

      // Even with 0 tokens, user-initiated must be allowed
      expect(limiter.tryConsume('room-1', 'user.manual')).toEqual({ allowed: true });
      expect(limiter.tryConsume('room-1', 'user.restart')).toEqual({ allowed: true });
    });

    it('does NOT bypass for reasons that do not start with "user."', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 0, initialTokens: 0, refillRateMs: 60_000 });

      expect(limiter.tryConsume('room-1', 'platform.crash_recovery').allowed).toBe(false);
      expect(limiter.tryConsume('room-1', 'system.restart').allowed).toBe(false);
    });
  });

  // ─── Token Refill Over Time ───────────────────────────────────────────────

  describe('token refill over time', () => {
    it('refills tokens after the refill interval', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 5, initialTokens: 1, refillRateMs: 60_000 });
      const chatroomId = 'room-refill';
      const reason = 'platform.restart';

      // Consume the only token
      expect(limiter.tryConsume(chatroomId, reason).allowed).toBe(true);
      // Now empty — should reject
      expect(limiter.tryConsume(chatroomId, reason).allowed).toBe(false);

      // Advance time by one refill interval
      vi.advanceTimersByTime(60_000);

      // Should have 1 token again
      expect(limiter.tryConsume(chatroomId, reason).allowed).toBe(true);
    });

    it('refills multiple tokens after multiple intervals', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 5, initialTokens: 0, refillRateMs: 10_000 });
      const chatroomId = 'room-multi-refill';
      const reason = 'platform.restart';

      // Prime the bucket by calling getStatus before advancing time
      limiter.getStatus(chatroomId);

      // Advance 3 refill intervals
      vi.advanceTimersByTime(30_000);

      // Should now have 3 tokens
      expect(limiter.tryConsume(chatroomId, reason).allowed).toBe(true);
      expect(limiter.tryConsume(chatroomId, reason).allowed).toBe(true);
      expect(limiter.tryConsume(chatroomId, reason).allowed).toBe(true);
      expect(limiter.tryConsume(chatroomId, reason).allowed).toBe(false);
    });

    it('does not exceed maxTokens when refilling', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 3, initialTokens: 2, refillRateMs: 10_000 });
      const chatroomId = 'room-cap';
      const reason = 'platform.restart';

      // Prime the bucket before advancing time
      limiter.getStatus(chatroomId);

      // Advance 5 refill intervals — would overflow without capping
      vi.advanceTimersByTime(50_000);

      const status = limiter.getStatus(chatroomId);
      expect(status.remaining).toBe(3);
      expect(status.total).toBe(3);
    });
  });

  // ─── Low-Token Warning ────────────────────────────────────────────────────

  describe('low token warning', () => {
    it('logs a warning when tokens drop to the threshold (≤ 1)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const limiter = new SpawnRateLimiter({ maxTokens: 3, initialTokens: 3, refillRateMs: 60_000 });
      const chatroomId = 'room-warn';
      const reason = 'platform.restart';

      // First two spawns — no warning yet
      limiter.tryConsume(chatroomId, reason); // 2 remaining
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('tokens running low'));

      limiter.tryConsume(chatroomId, reason); // 1 remaining — warning
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tokens running low'));
    });

    it('logs a rate-limit warning when bucket is exhausted', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const limiter = new SpawnRateLimiter({ maxTokens: 1, initialTokens: 1, refillRateMs: 60_000 });

      limiter.tryConsume('room-x', 'platform.restart'); // consume
      limiter.tryConsume('room-x', 'platform.restart'); // rate-limited

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rate-limited'));
    });
  });

  // ─── Independent Buckets Per Chatroom ────────────────────────────────────

  describe('independent buckets per chatroom', () => {
    it('tracks tokens independently for different chatrooms', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 2, initialTokens: 2, refillRateMs: 60_000 });
      const reason = 'platform.restart';

      // Exhaust room-A
      limiter.tryConsume('room-A', reason);
      limiter.tryConsume('room-A', reason);
      expect(limiter.tryConsume('room-A', reason).allowed).toBe(false);

      // room-B should still have a full bucket
      expect(limiter.tryConsume('room-B', reason).allowed).toBe(true);
      expect(limiter.tryConsume('room-B', reason).allowed).toBe(true);
      expect(limiter.tryConsume('room-B', reason).allowed).toBe(false);
    });

    it('getStatus returns independent status per chatroom', () => {
      const limiter = new SpawnRateLimiter({ maxTokens: 5, initialTokens: 5, refillRateMs: 60_000 });

      limiter.tryConsume('room-1', 'platform.restart');
      limiter.tryConsume('room-1', 'platform.restart');

      const status1 = limiter.getStatus('room-1');
      const status2 = limiter.getStatus('room-2');

      expect(status1.remaining).toBe(3);
      expect(status2.remaining).toBe(5);
    });
  });
});
