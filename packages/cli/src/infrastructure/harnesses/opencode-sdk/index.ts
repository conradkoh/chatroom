/**
 * Barrel re-export for the opencode-sdk direct harness.
 */

export { OpencodeSdkHarness, startOpencodeSdkHarness } from './opencode-harness.js';
export type { OpencodeSdkHarnessOptions } from './opencode-harness.js';

export { OpencodeSdkSession } from './opencode-session.js';
export type { OpencodeSdkSessionOptions } from './opencode-session.js';

export { createOpencodeSdkChunkExtractor } from './event-extractor.js';
export type { ExtractedChunk } from './event-extractor.js';
