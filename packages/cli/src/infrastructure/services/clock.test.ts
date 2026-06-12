/**
 * ClockService Tests — TDD unit tests for Effect-TS service layer.
 *
 * Tests use ClockServiceLive to verify real time behavior.
 */

import { Effect } from 'effect';
import { describe, it, expect } from 'vitest';

import { ClockService, ClockServiceLive } from './clock.js';

describe('ClockService', () => {
  it('now() returns a number', async () => {
    const result = await Effect.runPromise(
      ClockService.pipe(
        Effect.flatMap((c) => c.now()),
        Effect.provide(ClockServiceLive)
      )
    );
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('now() returns the current timestamp', async () => {
    const before = Date.now();
    const result = await Effect.runPromise(
      ClockService.pipe(
        Effect.flatMap((c) => c.now()),
        Effect.provide(ClockServiceLive)
      )
    );
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('delay() resolves after the given ms', async () => {
    const before = Date.now();
    await Effect.runPromise(
      ClockService.pipe(
        Effect.flatMap((c) => c.delay(10)),
        Effect.provide(ClockServiceLive)
      )
    );
    const after = Date.now();
    const elapsed = after - before;
    // Allow some tolerance for timer precision
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(elapsed).toBeLessThan(100);
  });

  it('delay(0) resolves quickly', async () => {
    const before = Date.now();
    await Effect.runPromise(
      ClockService.pipe(
        Effect.flatMap((c) => c.delay(0)),
        Effect.provide(ClockServiceLive)
      )
    );
    const after = Date.now();
    expect(after - before).toBeLessThan(50);
  });
});
