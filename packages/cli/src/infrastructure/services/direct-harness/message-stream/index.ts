/**
 * Barrel re-export for the message-stream infrastructure layer.
 */

export { BufferedMessageStreamSink } from './buffered-sink.js';
export type { BufferedSinkOptions } from './buffered-sink.js';

export { ConvexMessageStreamTransport } from './convex-transport.js';
export type { ConvexMessageStreamTransportOptions, ConvexMessageStreamTransportBackend } from './convex-transport.js';

export { IntervalFlushStrategy } from './strategies/interval-strategy.js';
export { SentenceFlushStrategy } from './strategies/sentence-strategy.js';
export { TokenCountFlushStrategy } from './strategies/token-count-strategy.js';
export { CompositeFlushStrategy } from './strategies/composite-strategy.js';
