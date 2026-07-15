'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useMemo, useRef, useState } from 'react';

import { decompressGzip, extractBase64Content } from '../utils/decompressGzip';

export interface FileContentResult {
  content: string;
  encoding: string;
  truncated: boolean;
  fetchedAt: number;
}

/**
 * Hook that fetches file content (v2) and handles decompression transparently.
 * Always returns `{ content, encoding, truncated, fetchedAt }`.
 * The `data` field from the v2 query is always base64-encoded gzip — we always decompress.
 * Pass `'skip'` to skip the query.
 */
export function useFileContent(
  args:
    | {
        machineId: string;
        workingDir: string;
        filePath: string;
      }
    | 'skip'
): FileContentResult | null | undefined {
  const rawResult = useSessionQuery(
    api.workspaceFiles.getFileContentV2,
    args === 'skip' ? 'skip' : args
  );

  const [decompressed, setDecompressed] = useState<FileContentResult | null | undefined>(undefined);
  const rawResultRef = useRef(rawResult);
  rawResultRef.current = rawResult;

  // Depend on compressed payload content, not the Convex row object identity.
  const compressedPayload = useMemo((): string | null | undefined => {
    if (rawResult === undefined) return undefined;
    if (rawResult === null) return null;
    return extractBase64Content(rawResult.data);
  }, [
    rawResult === undefined
      ? undefined
      : rawResult === null
        ? null
        : extractBase64Content(rawResult.data),
  ]);

  useEffect(() => {
    if (compressedPayload === undefined) {
      setDecompressed(undefined);
      return;
    }
    if (compressedPayload === null) {
      setDecompressed(null);
      return;
    }

    let cancelled = false;
    decompressGzip(compressedPayload)
      .then((content) => {
        const current = rawResultRef.current;
        if (!cancelled && current) {
          setDecompressed({
            content,
            encoding: current.encoding,
            truncated: current.truncated,
            fetchedAt: current.fetchedAt,
          });
        }
      })
      .catch((err) => {
        console.error('[useFileContent] Failed to decompress file content:', err);
        if (!cancelled) {
          setDecompressed(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [compressedPayload]);

  return decompressed;
}
