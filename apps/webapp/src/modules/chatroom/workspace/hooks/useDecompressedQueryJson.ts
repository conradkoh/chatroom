'use client';

import { useEffect, useMemo, useState } from 'react';

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

  // Depend on compressed payload content, not the Convex row object identity.
  // Reactive queries return a new object reference on each push, which would
  // otherwise cancel in-flight decompression and leave json stuck undefined.
  const compressedPayload = useMemo((): string | null | undefined => {
    if (!enabled) return undefined;
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    return extractBase64Content(raw.data);
  }, [
    enabled,
    raw === undefined ? undefined : raw === null ? null : extractBase64Content(raw.data),
  ]);

  useEffect(() => {
    if (!enabled || compressedPayload === undefined) {
      setJson(undefined);
      return;
    }
    if (compressedPayload === null) {
      setJson(null);
      return;
    }

    let cancelled = false;
    setJson(undefined);
    decompressGzip(compressedPayload)
      .then((content) => {
        if (!cancelled) setJson(content);
      })
      .catch(() => {
        if (!cancelled) setJson(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, compressedPayload]);

  return json;
}
