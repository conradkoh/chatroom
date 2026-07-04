'use client';

import { useEffect, useState } from 'react';

import {
  decompressGzip,
  extractBase64Content,
  type CompressedQueryData,
} from '../utils/decompressGzip';

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
  const [json, setJson] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setJson(undefined);
      return;
    }
    if (raw === undefined) {
      setJson(undefined);
      return;
    }
    if (raw === null) {
      setJson(null);
      return;
    }

    let cancelled = false;
    decompressGzip(extractBase64Content(raw.data))
      .then((content) => {
        if (!cancelled) setJson(content);
      })
      .catch(() => {
        if (!cancelled) setJson(null);
      });
    return () => {
      cancelled = true;
    };
  }, [raw, enabled]);

  return json;
}
