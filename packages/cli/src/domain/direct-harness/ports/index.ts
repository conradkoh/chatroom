/**
 * Barrel re-export for domain/direct-harness/ports.
 */

// ─── Repository ports (new) ───────────────────────────────────────────────────

export type { SessionRepository } from './session-repository.js';
export type { OutputRepository, OutputChunk } from './output-repository.js';

// ─── Other ports ──────────────────────────────────────────────────────────────

export type { CapabilitiesPublisher } from './capabilities-publisher.js';
