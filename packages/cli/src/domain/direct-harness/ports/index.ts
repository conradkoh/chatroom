/**
 * Barrel re-export for domain/direct-harness/ports.
 *
 * New repository ports:
 *   SessionRepository, OutputRepository, PromptRepository
 *
 * Legacy ports (still used by existing infrastructure, will be removed in a future pass):
 *   FlushStrategy, MessageStreamSink, MessageStreamTransport
 */

// ─── New repository ports ─────────────────────────────────────────────────────

export type { SessionRepository } from './session-repository.js';
export type { OutputRepository, OutputChunk } from './output-repository.js';
export type { PromptRepository, PromptOverride } from './prompt-repository.js';

// ─── Legacy ports (backwards compat) ──────────────────────────────────────────

export type { FlushContext, FlushStrategy } from './flush-strategy.js';
export type { MessageStreamChunk, MessageStreamTransport } from './message-stream-transport.js';
export type {
  MessageStreamSink,
  MessageStreamSinkWarning,
} from './message-stream-sink.js';

// ─── Other ports ──────────────────────────────────────────────────────────────

export type { CapabilitiesPublisher } from './capabilities-publisher.js';
