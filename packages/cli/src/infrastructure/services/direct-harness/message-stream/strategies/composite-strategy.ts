/**
 * @deprecated Flush strategies are now internal to BufferedJournalFactory
 *             (time-based interval). Retained only until old callers migrate.
 *
 * OR-combines multiple flush strategies — flushes if ANY child returns true.
 */

import type { FlushStrategy, FlushContext } from '../../../../../domain/direct-harness/ports/index.js';

/**
 * Composes a list of strategies: flushes when any one of them signals a flush.
 * The `name` property reflects all child strategy names for observability.
 */
export class CompositeFlushStrategy implements FlushStrategy {
  readonly name: string;

  constructor(private readonly strategies: readonly FlushStrategy[]) {
    this.name = `composite(${strategies.map((s) => s.name).join('+')})`;
  }

  shouldFlush<T>(buffer: readonly T[], ctx: FlushContext): boolean {
    return this.strategies.some((s) => s.shouldFlush(buffer, ctx));
  }
}
