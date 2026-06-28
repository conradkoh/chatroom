import { createStandardSdkChunkExtractor } from '../shared-chunk-extractor.js';

/** Chunk extractor for pi-sdk direct harness sessions. */
export function createPiSdkChunkExtractor() {
  return createStandardSdkChunkExtractor();
}
