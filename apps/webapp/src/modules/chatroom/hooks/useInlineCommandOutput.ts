'use client';

import { useCallback, useState } from 'react';

import type { CommandRun } from '../features/run-command/types/run';
import { useActiveRunOutput } from './useActiveRunOutput';
import type { useCommandRunner } from './useCommandRunner';

/** Maximum number of output lines to keep in buffer to prevent memory issues */
const MAX_OUTPUT_LINES = 1000;

/** Reactive state for an inline command output panel (lifted from parent) */
export interface InlineCommandState {
  /** The command name currently showing output (null if no output panel is visible) */
  commandName: string | null;
  /** The script of the current command (needed for "run again") */
  script: string | null;
  /** Whether the command is currently running */
  isRunning: boolean;
  /** The status of the active run (null if no active run) */
  status: CommandRun['status'] | null;
  /** The termination reason if the run was killed (null if not applicable) */
  terminationReason: string | null;
  /** Output lines from the active run */
  output: string[];
  /** Start or restart a command by name and script */
  run: (commandName: string, script: string) => void;
  /** Stop the currently running command (explicit kill — for Stop button only) */
  stop: () => void;
  /**
   * Attach the UI panel to an existing run (e.g. after page reload or panel detach).
   * Sets the active run WITHOUT dispatching a new mutation.
   */
  attach: (runId: string, commandName: string, script: string) => void;
  /**
   * Detach the UI panel from the current command WITHOUT stopping the process.
   * Use for dialog/panel close gestures. The command continues running in the background.
   */
  detach: () => void;
  /** Close the output panel (stop + clear state). Kept for backward compatibility — prefer detach() for panel-close gestures. */
  close: () => void;
}

/**
 * Hook that manages inline command output state directly from reactive Convex data.
 *
 * The `getRunOutput` subscription is demand-driven: it's skipped when no output
 * modal is visible (`commandName === null`). Convex's client-side query dedup
 * means multiple consumers of the same `runId` share one backend subscription.
 *
 * @param commandRunner - The command runner hook return value from useCommandRunner
 */
export function useInlineCommandOutput(
  commandRunner: ReturnType<typeof useCommandRunner>
): InlineCommandState {
  const [commandName, setCommandName] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);

  // Subscribe only when the output modal is actually visible (commandName non-null)
  const activeRunOutput = useActiveRunOutput(
    commandName !== null ? commandRunner.activeRunId : null
  );

  // Derive isRunning, status, terminationReason, and output directly from reactive Convex state (no closures)
  const isRunning = activeRunOutput.run?.status === 'running';
  const status = activeRunOutput.run?.status ?? null;
  const terminationReason = activeRunOutput.run?.terminationReason ?? null;
  const output = activeRunOutput.chunks
    .map((c) => c.content)
    .slice(-MAX_OUTPUT_LINES);

  const run = useCallback(
    (name: string, scriptStr: string) => {
      setCommandName(name);
      setScript(scriptStr);
      // runCommand handles "already running" case by reusing the existing run
      commandRunner.runCommand(name, scriptStr);
    },
    [commandRunner.runCommand]
  );

  const stop = useCallback(() => {
    // Use CURRENT activeRunId (not closure-captured) to avoid targeting stale runs
    if (commandRunner.activeRunId) {
      commandRunner.stopCommand(commandRunner.activeRunId);
    }
  }, [commandRunner.activeRunId, commandRunner.stopCommand]);

  /** Detach the UI panel without killing the process. */
  const detach = useCallback(() => {
    setCommandName(null);
    setScript(null);
  }, []);

  /**
   * Attach the UI panel to an existing run (e.g. after page reload or detach).
   * Does NOT dispatch a new mutation — just rehydrates the panel state.
   */
  const attach = useCallback(
    (runId: string, cmdName: string, scriptStr: string) => {
      setCommandName(cmdName);
      setScript(scriptStr);
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
  };
}
