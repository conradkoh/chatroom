/**
 * Flushes when the buffer reaches a maximum item count or byte size.
 */

import type { FlushStrategy, FlushContext } from '../../../../../domain/direct-harness/message-stream/index.js';

/** Triggers a flush once the buffer contains `maxItems` items or `maxBytes` total content bytes. */
export class TokenCountFlushStrategy implements FlushStrategy {
  readonly name = 'token-count';

  constructor(
    private readonly maxItems: number,
    private readonly maxBytes: number = Number.POSITIVE_INFINITY,
  ) {}

  shouldFlush<T>(_buffer: readonly T[], ctx: FlushContext): boolean {
    return ctx.bufferItemCount >= this.maxItems || ctx.bufferByteSize >= this.maxBytes;
  }
}
