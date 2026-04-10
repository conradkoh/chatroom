import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useState } from 'react';
import { api } from '@workspace/backend/convex/_generated/api';
import { decompressGzip } from '../utils/decompressGzip';

interface FileTreeResult {
  treeJson: string;
  scannedAt: number;
}

/**
 * Hook that fetches the file tree (v2) and handles decompression transparently.
 * Always returns `{ treeJson, scannedAt }`. The `data` field from the v2 query
 * is always base64-encoded gzip — we always decompress.
 */
export function useFileTree(
  args: { machineId: string; workingDir: string } | 'skip'
): FileTreeResult | null | undefined {
  const rawResult = useSessionQuery(
    api.workspaceFiles.getFileTreeV2,
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

    // V2: data is always base64-encoded gzip — decompress
    let cancelled = false;
    decompressGzip(rawResult.data.content)
      .then((treeJson) => {
        if (!cancelled) {
          setDecompressed({
            treeJson,
            scannedAt: rawResult.scannedAt,
          });
        }
      })
      .catch((err) => {
        console.error('[useFileTree] Failed to decompress file tree:', err);
        if (!cancelled) {
          setDecompressed(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rawResult]);

  return decompressed;
}
