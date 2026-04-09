import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useState } from 'react';
import { api } from '@workspace/backend/convex/_generated/api';

/**
 * Decompress a base64-encoded gzip string using the browser's DecompressionStream API.
 */
async function decompressGzip(base64Data: string): Promise<string> {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

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
