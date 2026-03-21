import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HarnessSpawningService } from './harness-spawning-service.js';
import type { SpawnRateLimiter } from './rate-limiter.js';

// ─── Helper: create a mock rate limiter ───────────────────────────────────────

function createMockRateLimiter(allowed: boolean, retryAfterMs?: number): SpawnRateLimiter {
  return {
    tryConsume: vi.fn().mockReturnValue({ allowed, retryAfterMs }),
    getStatus: vi.fn().mockReturnValue({ remaining: 5, total: 5 }),
  } as unknown as SpawnRateLimiter;
}

describe('HarnessSpawningService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── shouldAllowSpawn — rate limiter approves ─────────────────────────────

  describe('shouldAllowSpawn — rate limiter approves', () => {
    it('returns allowed: true when rate limiter approves and concurrency limit is not hit', () => {
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });

      const result = service.shouldAllowSpawn('room-1', 'platform.restart');
      expect(result.allowed).toBe(true);
      expect(rateLimiter.tryConsume).toHaveBeenCalledWith('room-1', 'platform.restart');
    });
  });

  // ─── shouldAllowSpawn — rate limiter rejects ──────────────────────────────

  describe('shouldAllowSpawn — rate limiter rejects', () => {
    it('returns allowed: false when rate limiter rejects', () => {
      const rateLimiter = createMockRateLimiter(false, 30_000);
      const service = new HarnessSpawningService({ rateLimiter });

      const result = service.shouldAllowSpawn('room-1', 'platform.restart');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(30_000);
    });

    it('logs a warning when rate limiter rejects', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rateLimiter = createMockRateLimiter(false);
      const service = new HarnessSpawningService({ rateLimiter });

      service.shouldAllowSpawn('room-1', 'platform.restart');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Spawn blocked by rate limiter')
      );
    });
  });

  // ─── Concurrent Agent Limit ───────────────────────────────────────────────

  describe('concurrent agent limit enforcement', () => {
    it('rejects spawn when concurrent limit is reached (10)', () => {
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });
      const chatroomId = 'room-concurrent';

      // Simulate 10 active agents
      for (let i = 0; i < 10; i++) {
        service.recordSpawn(chatroomId);
      }

      const result = service.shouldAllowSpawn(chatroomId, 'platform.restart');
      expect(result.allowed).toBe(false);
      // Rate limiter should NOT be consulted — we short-circuit before it
      expect(rateLimiter.tryConsume).not.toHaveBeenCalled();
    });

    it('logs a warning when concurrent limit is hit', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });

      service.recordSpawn('room-x');
      service.recordSpawn('room-x');
      service.recordSpawn('room-x');
      for (let i = 0; i < 7; i++) {
        service.recordSpawn('room-x');
      }

      service.shouldAllowSpawn('room-x', 'platform.restart');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Concurrent agent limit reached')
      );
    });

    it('allows spawn again after an agent exits (below limit)', () => {
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });
      const chatroomId = 'room-exit';

      for (let i = 0; i < 10; i++) {
        service.recordSpawn(chatroomId);
      }

      // One exits
      service.recordExit(chatroomId);

      const result = service.shouldAllowSpawn(chatroomId, 'platform.restart');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── recordSpawn / recordExit ─────────────────────────────────────────────

  describe('recordSpawn and recordExit tracking', () => {
    it('increments concurrent count on recordSpawn', () => {
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });

      expect(service.getConcurrentCount('room-1')).toBe(0);
      service.recordSpawn('room-1');
      expect(service.getConcurrentCount('room-1')).toBe(1);
      service.recordSpawn('room-1');
      expect(service.getConcurrentCount('room-1')).toBe(2);
    });

    it('decrements concurrent count on recordExit', () => {
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });

      service.recordSpawn('room-1');
      service.recordSpawn('room-1');
      service.recordExit('room-1');
      expect(service.getConcurrentCount('room-1')).toBe(1);
    });

    it('does not go below 0 on excess recordExit calls', () => {
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });

      service.recordExit('room-1'); // no prior spawn
      expect(service.getConcurrentCount('room-1')).toBe(0);
    });

    it('tracks counts independently per chatroom', () => {
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });

      service.recordSpawn('room-A');
      service.recordSpawn('room-A');
      service.recordSpawn('room-B');

      expect(service.getConcurrentCount('room-A')).toBe(2);
      expect(service.getConcurrentCount('room-B')).toBe(1);
    });
  });
});
