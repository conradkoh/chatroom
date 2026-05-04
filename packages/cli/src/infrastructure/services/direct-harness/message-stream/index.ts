/**
 * @deprecated Use BufferedJournalFactory + OutputRepository instead
 *             (infrastructure/repos/journal-factory.ts and output-repository.ts).
 *
 * Barrel re-export for the message-stream infrastructure layer.
 *
 * This entire directory is the v1 output pipeline. Chunks were buffered in a
 * MessageStreamSink and flushed via a MessageStreamTransport. The new approach
 * uses SessionJournal (same buffering semantics) + OutputRepository (flush via
 * Convex mutation), with a time-based drain interval in BufferedJournalFactory.
 */

export { BufferedMessageStreamSink } from './buffered-sink.js';
export type { BufferedSinkOptions } from './buffered-sink.js';

export { ConvexMessageStreamTransport } from './convex-transport.js';
export type { ConvexMessageStreamTransportOptions, ConvexMessageStreamTransportBackend } from './convex-transport.js';

export { IntervalFlushStrategy } from './strategies/interval-strategy.js';
export { SentenceFlushStrategy } from './strategies/sentence-strategy.js';
export { TokenCountFlushStrategy } from './strategies/token-count-strategy.js';
export { CompositeFlushStrategy } from './strategies/composite-strategy.js';
