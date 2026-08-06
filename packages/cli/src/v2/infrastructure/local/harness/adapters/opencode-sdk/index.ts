/**
 * Barrel re-export for the opencode-sdk direct harness.
 *
 * Only exports what external callers actually use. Internal callers (tests,
 * harness-internal modules) import directly from the source files.
 */

export { startOpencodeSdkHarness } from './opencode-harness.js';
export { createOpencodeSdkChunkExtractor } from './event-extractor.js';
