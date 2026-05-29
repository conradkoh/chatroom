'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';

import type { CommandRun } from '../features/run-command/types/run';
import { useActiveRunOutput } from './useActiveRunOutput';
import type { useCommandRunner } from './useCommandRunner';

/** Maximum number of output lines to keep in buffer to prevent memory issues */
const MAX_OUTPUT_LINES = 1000;

/** Reactive state for an inline command output panel (lifted from parent) */
export interface InlineCommandState {
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
  /** Request full log file sync from daemon (active runs only). */
  loadMore: () => Promise<void>;
  canLoadMore: boolean;
  fullOutputPending: boolean;
}

export function useInlineCommandOutput(
  commandRunner: ReturnType<typeof useCommandRunner>
): InlineCommandState {
  const [commandName, setCommandName] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [loadFull, setLoadFull] = useState(false);

  const activeRunId = commandName !== null ? commandRunner.activeRunId : null;

  const activeRunOutput = useActiveRunOutput(activeRunId, { loadFull });
  const setLogObserver = useSessionMutation(api.commands.setRunLogObserver);
  const requestFullSync = useSessionMutation(api.commands.requestRunOutputFullSync);

  useEffect(() => {
    if (!activeRunId || commandName === null) return;

    void setLogObserver({ runId: activeRunId as any, observing: true });
    return () => {
      void setLogObserver({ runId: activeRunId as any, observing: false });
    };
  }, [activeRunId, commandName, setLogObserver]);

  useEffect(() => {
    if (commandName === null) {
      setLoadFull(false);
    }
  }, [commandName]);

  const isRunning = activeRunOutput.run?.status === 'running';
  const status = activeRunOutput.run?.status ?? null;
  const terminationReason = activeRunOutput.run?.terminationReason ?? null;
  const output = activeRunOutput.chunks
    .map((c) => c.content)
    .join('')
    .split('\n')
    .slice(-MAX_OUTPUT_LINES);

  const loadMore = useCallback(async () => {
    if (!activeRunId) return;
    setLoadFull(true);
    await requestFullSync({ runId: activeRunId as any });
  }, [activeRunId, requestFullSync]);

  const run = useCallback(
    (name: string, scriptStr: string) => {
      setCommandName(name);
      setScript(scriptStr);
      setLoadFull(false);
      commandRunner.runCommand(name, scriptStr);
    },
    [commandRunner.runCommand]
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

  return {
    commandName,
    script,
    isRunning,
    status,
    terminationReason,
    output,
    run,
    stop,
    attach,
    detach,
    close,
    loadMore,
    canLoadMore: activeRunOutput.canLoadMore || (!loadFull && isRunning),
    fullOutputPending: activeRunOutput.fullOutputPending,
  };
}
