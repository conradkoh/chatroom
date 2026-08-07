import { createStandardSdkChunkExtractor } from '../shared-chunk-extractor.js';

/** Chunk extractor for cursor-sdk direct harness sessions. */
export function createCursorSdkChunkExtractor() {
  return createStandardSdkChunkExtractor();
}
