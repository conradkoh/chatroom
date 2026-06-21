import { afterEach, describe, expect, it, vi } from 'vitest';

import { HarnessSpawningService } from './harness-spawning-service.js';
import type { SpawnRateLimiter } from './rate-limiter.js';

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

  describe('shouldAllowSpawn — rate limiter approves', () => {
    it('returns allowed: true when rate limiter approves', () => {
      const rateLimiter = createMockRateLimiter(true);
      const service = new HarnessSpawningService({ rateLimiter });

      const result = service.shouldAllowSpawn('room-1', 'platform.restart');
      expect(result.allowed).toBe(true);
      expect(rateLimiter.tryConsume).toHaveBeenCalledWith('room-1', 'platform.restart');
    });
  });

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
});
