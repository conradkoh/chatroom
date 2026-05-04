/**
 * Barrel re-export for domain/direct-harness/ports.
 */

// ─── Repository ports (new) ───────────────────────────────────────────────────

export type { SessionRepository } from './session-repository.js';
export type { OutputRepository, OutputChunk } from './output-repository.js';
export type { PromptRepository, PromptOverride } from './prompt-repository.js';

// ─── Legacy message-stream ports (to be removed after migration) ───────────────

export type { FlushContext, FlushStrategy } from './flush-strategy.js';
export type { MessageStreamChunk, MessageStreamTransport } from './message-stream-transport.js';
export type { MessageStreamSink, MessageStreamSinkWarning } from './message-stream-sink.js';

// ─── Other ports ──────────────────────────────────────────────────────────────

export type { CapabilitiesPublisher } from './capabilities-publisher.js';
