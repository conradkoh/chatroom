'use client';

import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useState } from 'react';
import { api } from '@workspace/backend/convex/_generated/api';
import { decompressGzip } from '../utils/decompressGzip';

interface FileContentResult {
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
export function useFileContent(args: {
  machineId: string;
  workingDir: string;
  filePath: string;
} | 'skip'): FileContentResult | null | undefined {
  const rawResult = useSessionQuery(
    api.workspaceFiles.getFileContentV2,
    args === 'skip' ? 'skip' : args
  );

  const [decompressed, setDecompressed] = useState<FileContentResult | null | undefined>(undefined);

  useEffect(() => {
    if (rawResult === undefined) {
      setDecompressed(undefined);
      return;
    }
    if (rawResult === null) {
      setDecompressed(null);
      return;
    }

    // V2: data is always base64-encoded gzip — decompress
    let cancelled = false;
    decompressGzip(rawResult.data).then((content) => {
      if (!cancelled) {
        setDecompressed({
          content,
          encoding: rawResult.encoding,
          truncated: rawResult.truncated,
          fetchedAt: rawResult.fetchedAt,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [rawResult]);

  return decompressed;
}
