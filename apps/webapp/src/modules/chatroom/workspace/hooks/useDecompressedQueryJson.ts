'use client';

import { useAsyncGzipDecompress } from './useAsyncGzipDecompress';
import { extractBase64Content, type CompressedQueryData } from '../utils/decompressGzip';

export type CompressedQueryRow = {
  data: CompressedQueryData;
};

/**
 * Decompress the `data` field from a Convex V2 gzip query row.
 * - `undefined`: loading (query pending or decompress in flight)
 * - `null`: no row or decompress failed
 * - `string`: decompressed UTF-8 content (typically JSON)
 */
export function useDecompressedQueryJson(
  raw: CompressedQueryRow | null | undefined,
  enabled: boolean
): string | null | undefined {
  const compressedPayload = !enabled
    ? undefined
    : raw === undefined
      ? undefined
      : raw === null
        ? null
        : extractBase64Content(raw.data);
  return useAsyncGzipDecompress(compressedPayload, enabled);
}
