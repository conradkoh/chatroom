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
 * Hook that fetches file content and handles decompression transparently.
 * Always returns `{ content, encoding, truncated, fetchedAt }` regardless of whether
 * the backend sent compressed or uncompressed data.
 * Pass `'skip'` to skip the query.
 */
export function useFileContent(args: {
  machineId: string;
  workingDir: string;
  filePath: string;
} | 'skip'): FileContentResult | null | undefined {
  const rawResult = useSessionQuery(
    api.workspaceFiles.getFileContent,
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

    // Compressed response — decompress async
    if (
      'contentCompressed' in rawResult &&
      rawResult.contentCompressed &&
      'compression' in rawResult &&
      rawResult.compression === 'gzip'
    ) {
      let cancelled = false;
      decompressGzip(rawResult.contentCompressed).then((content) => {
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
    }

    // Uncompressed response — return directly
    setDecompressed({
      content: rawResult.content,
      encoding: rawResult.encoding,
      truncated: rawResult.truncated,
      fetchedAt: rawResult.fetchedAt,
    });
  }, [rawResult]);

  return decompressed;
}
