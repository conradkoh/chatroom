/**
 * Flushes when at least `intervalMs` has elapsed since the last flush.
 */

import type { FlushStrategy, FlushContext } from '../../../../../domain/direct-harness/ports/index.js';

/** Triggers a flush once `intervalMs` milliseconds have passed since the last successful flush. */
export class IntervalFlushStrategy implements FlushStrategy {
  readonly name = 'interval';

  constructor(private readonly intervalMs: number) {}

  shouldFlush<T>(buffer: readonly T[], ctx: FlushContext): boolean {
    if (buffer.length === 0) return false;
    return ctx.now - ctx.lastFlushAt >= this.intervalMs;
  }
}
