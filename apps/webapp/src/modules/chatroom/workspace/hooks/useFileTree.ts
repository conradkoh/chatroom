import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useState } from 'react';
import { api } from '@workspace/backend/convex/_generated/api';
import { decompressGzip } from '../utils/decompressGzip';

/**
 * Decompress is now in ../utils/decompressGzip.ts
 */

interface FileTreeResult {
  treeJson: string;
  scannedAt: number;
}

/**
 * Hook that fetches the file tree and handles decompression transparently.
 * Always returns `{ treeJson, scannedAt }` regardless of whether the backend
 * sent compressed or uncompressed data.
 */
export function useFileTree(
  args: { machineId: string; workingDir: string } | 'skip'
): FileTreeResult | null | undefined {
  const rawResult = useSessionQuery(
    api.workspaceFiles.getFileTree,
    args === 'skip' ? 'skip' : args
  );

  const [decompressed, setDecompressed] = useState<FileTreeResult | null | undefined>(undefined);

  useEffect(() => {
    if (rawResult === undefined) {
      setDecompressed(undefined);
      return;
    }
    if (rawResult === null) {
      setDecompressed(null);
      return;
    }

    // Uncompressed response — return directly
    if ('treeJson' in rawResult && rawResult.treeJson) {
      setDecompressed({
        treeJson: rawResult.treeJson,
        scannedAt: rawResult.scannedAt,
      });
      return;
    }

    // Compressed response — decompress async
    if (
      'treeJsonCompressed' in rawResult &&
      rawResult.treeJsonCompressed &&
      'compression' in rawResult &&
      rawResult.compression === 'gzip'
    ) {
      let cancelled = false;
      decompressGzip(rawResult.treeJsonCompressed).then((treeJson) => {
        if (!cancelled) {
          setDecompressed({
            treeJson,
            scannedAt: rawResult.scannedAt,
          });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    // Fallback: no data
    setDecompressed(null);
  }, [rawResult]);

  return decompressed;
}
