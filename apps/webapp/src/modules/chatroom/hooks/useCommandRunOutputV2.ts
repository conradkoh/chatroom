/**
 * useCommandRunOutputV2 — single demand-driven subscription for command run output.
 *
 * Replaces useActiveRunOutput + useInlineCommandOutput. One getRunOutputV2 query and
 * controlRunOutputV2 observer lifecycle shared by Processes panel, terminal, and palette.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { decodeOutputBrowser } from '@workspace/backend/src/output-encoding-browser';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { useCommandRunner } from './useCommandRunner';
import type { CommandRun } from '../features/run-command/types/run';

/** Maximum number of output lines to keep in buffer to prevent memory issues */
const MAX_OUTPUT_LINES = 1000;

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

/** Reactive state for command palette inline output (lifted from parent) */
export interface CommandPaletteOutputState {
  commandName: string | null;
  script: string | null;
  isRunning: boolean;
  status: CommandRun['status'] | null;
  terminationReason: string | null;
  output: string[];
  run: (commandName: string, script: string) => void;
  stop: () => void;
  attach: (runId: string, commandName: string, script: string) => void;
  detach: () => void;
  close: () => void;
  loadMore: () => Promise<void>;
  canLoadMore: boolean;
  fullOutputPending: boolean;
}

/** @deprecated Use CommandPaletteOutputState */
export type InlineCommandState = CommandPaletteOutputState;

export interface UseCommandRunOutputV2Options {
  /** Subscribe when processes panel or terminal output is visible */
  panelOutputVisible: boolean;
}

export function useCommandRunOutputV2(
  commandRunner: ReturnType<typeof useCommandRunner>,
  options: UseCommandRunOutputV2Options
) {
  const [commandName, setCommandName] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [loadFull, setLoadFull] = useState(false);

  const subscribeRunId = useMemo(() => {
    const paletteOpen = commandName !== null;
    const panelOpen = options.panelOutputVisible;
    if (!commandRunner.activeRunId) return null;
    if (paletteOpen || panelOpen) return commandRunner.activeRunId;
    return null;
  }, [commandName, options.panelOutputVisible, commandRunner.activeRunId]);

  const controlOutput = useSessionMutation(api.commands.controlRunOutputV2);

  useEffect(() => {
    if (!subscribeRunId) return;

    void controlOutput({ runId: subscribeRunId as any, action: 'observe' });
    return () => {
      void controlOutput({ runId: subscribeRunId as any, action: 'unobserve' });
    };
  }, [subscribeRunId, controlOutput]);

  const raw = useSessionQuery(
    api.commands.getRunOutputV2,
    subscribeRunId ? { runId: subscribeRunId as any, loadFull } : 'skip'
  ) as { run: any; tail: any; chunks: any[]; fullOutputPending: boolean } | undefined;

  const result = raw ?? { run: null, tail: null, chunks: [], fullOutputPending: false };

  const [decodedChunks, setDecodedChunks] = useState<DecodedChunk[]>([]);
  const decodeIdRef = useRef(0);

  const decodeKey = useMemo(() => {
    const t = result.tail as RawTail | null;
    if (t) return `tail:${t.updatedAt}`;
    const rc = result.chunks as RawChunk[];
    if (rc.length === 0) return 'empty';
    const last = rc.at(-1);
    if (!last) return 'empty';
    const lastContent = typeof last.content === 'string' ? last.content : last.content.content;
    return `chunks:${rc.length}:${lastContent}`;
  }, [result.tail, result.chunks]);

  useEffect(() => {
    const id = ++decodeIdRef.current;
    let cancelled = false;

    (async () => {
      const decoded: DecodedChunk[] = [];

      const rc = result.chunks as RawChunk[];
      if (rc.length > 0) {
        for (const c of rc) {
          try {
            const text = await decodeOutputBrowser(c.content);
            decoded.push({ chunkIndex: c.chunkIndex, content: text, timestamp: c.timestamp });
          } catch {
            const fallback = typeof c.content === 'string' ? c.content : c.content.content;
            decoded.push({ chunkIndex: c.chunkIndex, content: fallback, timestamp: c.timestamp });
          }
        }
      } else {
        const t = result.tail as RawTail | null;
        if (t) {
          try {
            const text = await decodeOutputBrowser(t);
            decoded.push({ chunkIndex: 0, content: text, timestamp: t.updatedAt });
          } catch {
            decoded.push({ chunkIndex: 0, content: t.content, timestamp: t.updatedAt });
          }
        }
      }

      if (!cancelled && id === decodeIdRef.current) {
        setDecodedChunks(decoded);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [decodeKey]);

  useEffect(() => {
    if (commandName === null) {
      setLoadFull(false);
    }
  }, [commandName]);

  const isActive = result.run?.status === 'running' || result.run?.status === 'pending';

  const canLoadMore =
    isActive &&
    !loadFull &&
    (result.run?.tailOutput?.totalBytesWritten ?? result.tail?.totalBytesWritten ?? 0) > 0;

  const loadMore = useCallback(async () => {
    if (!subscribeRunId) return;
    setLoadFull(true);
    await controlOutput({ runId: subscribeRunId as any, action: 'requestFull' });
  }, [subscribeRunId, controlOutput]);

  const isRunning = result.run?.status === 'running';
  const status = result.run?.status ?? null;
  const terminationReason = result.run?.terminationReason ?? null;
  const outputLines = decodedChunks
    .map((c) => c.content)
    .join('')
    .split('\n')
    .slice(-MAX_OUTPUT_LINES);

  const run = useCallback(
    (name: string, scriptStr: string) => {
      setCommandName(name);
      setScript(scriptStr);
      setLoadFull(false);
      void commandRunner.runOrAttach(name, scriptStr);
    },
    [commandRunner]
  );

  const stop = useCallback(() => {
    if (commandRunner.activeRunId) {
      commandRunner.stopCommand(commandRunner.activeRunId);
    }
  }, [commandRunner.activeRunId, commandRunner.stopCommand]);

  const detach = useCallback(() => {
    setCommandName(null);
    setScript(null);
  }, []);

  const attach = useCallback(
    (runId: string, cmdName: string, scriptStr: string) => {
      setCommandName(cmdName);
      setScript(scriptStr);
      setLoadFull(false);
      commandRunner.setActiveRunId(runId);
    },
    [commandRunner.setActiveRunId]
  );

  const close = useCallback(() => {
    stop();
    setCommandName(null);
    setScript(null);
  }, [stop]);

  const palette: CommandPaletteOutputState = {
    commandName,
    script,
    isRunning,
    status,
    terminationReason,
    output: outputLines,
    run,
    stop,
    attach,
    detach,
    close,
    loadMore,
    canLoadMore: canLoadMore || (!loadFull && isRunning),
    fullOutputPending: result.fullOutputPending,
  };

  const activeRunOutput = {
    run: result.run,
    chunks: decodedChunks,
    fullOutputPending: result.fullOutputPending,
    canLoadMore,
    loadMore,
  };

  return { activeRunOutput, palette };
}
