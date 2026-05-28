/**
 * useActiveRunOutput — demand-driven subscription for command run output.
 *
 * Each consumer independently calls this hook when it needs live output.
 * Convex deduplicates identical queries client-side, so multiple consumers
 * subscribing to the same `runId` cause only one backend subscription.
 * When all consumers unmount (or pass `null`), the query unsubscribes.
 */

'use client';

import { useEffect, useRef, useMemo, useState } from 'react';

import { api } from '@workspace/backend/convex/_generated/api';
import { decodeOutputBrowser } from '@workspace/backend/src/output-encoding-browser';
import { useSessionQuery } from 'convex-helpers/react/sessions';

interface RawChunk {
  content: string | { compression: 'gzip'; content: string };
  chunkIndex: number;
  timestamp: number;
}

interface RawTail {
  compression: 'gzip';
  content: string;
  totalBytesWritten: number;
  updatedAt: number;
}

interface DecodedChunk {
  content: string;
  chunkIndex: number;
  timestamp: number;
}

export function useActiveRunOutput(activeRunId: string | null) {
  const raw = useSessionQuery(
    api.commands.getRunOutput,
    activeRunId ? { runId: activeRunId as any } : 'skip'
  ) as { run: any; tail: any; chunks: any[] } | undefined;

  const result = raw ?? { run: null, tail: null, chunks: [] };

  const [decodedChunks, setDecodedChunks] = useState<DecodedChunk[]>([]);
  const decodeIdRef = useRef(0);

  const decodeKey = useMemo(() => {
    const t = result.tail as RawTail | null;
    if (t) return `tail:${t.updatedAt}`;
    const rc = result.chunks as RawChunk[];
    if (rc.length === 0) return 'empty';
    const last = rc[rc.length - 1]!;
    const lastContent = typeof last.content === 'string' ? last.content : last.content.content;
    return `chunks:${rc.length}:${lastContent}`;
  }, [result.tail, result.chunks]);

  useEffect(() => {
    const id = ++decodeIdRef.current;
    let cancelled = false;

    (async () => {
      const decoded: DecodedChunk[] = [];

      const t = result.tail as RawTail | null;
      if (t) {
        try {
          const text = await decodeOutputBrowser(t);
          decoded.push({ chunkIndex: 0, content: text, timestamp: t.updatedAt });
        } catch {
          decoded.push({ chunkIndex: 0, content: t.content, timestamp: t.updatedAt });
        }
      } else {
        const rc = result.chunks as RawChunk[];
        for (const c of rc) {
          try {
            const text = await decodeOutputBrowser(c.content);
            decoded.push({ chunkIndex: c.chunkIndex, content: text, timestamp: c.timestamp });
          } catch {
            const fallback = typeof c.content === 'string' ? c.content : c.content.content;
            decoded.push({ chunkIndex: c.chunkIndex, content: fallback, timestamp: c.timestamp });
          }
        }
      }

      if (!cancelled && id === decodeIdRef.current) {
        setDecodedChunks(decoded);
      }
    })();

    return () => { cancelled = true; };
  }, [decodeKey]);

  return { run: result.run, chunks: decodedChunks };
}
