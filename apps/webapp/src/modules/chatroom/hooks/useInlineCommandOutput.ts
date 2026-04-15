'use client';

import { useCallback, useState } from 'react';

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
  /** Output lines from the active run */
  output: string[];
  /** Start or restart a command by name and script */
  run: (commandName: string, script: string) => void;
  /** Stop the currently running command */
  stop: () => void;
  /** Close the output panel (stop + clear state) */
  close: () => void;
}

/**
 * Hook that manages inline command output state directly from reactive Convex data.
 *
 * Replaces the closure-based RunnableCommandHandle pattern with direct reactive state,
 * eliminating stale closure bugs. Output is derived from `commandRunner.activeRunOutput`
 * on every render — no subscriptions, no callbacks.
 *
 * @param commandRunner - The command runner hook return value from useCommandRunner
 */
export function useInlineCommandOutput(
  commandRunner: ReturnType<typeof useCommandRunner>
): InlineCommandState {
  const [commandName, setCommandName] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);

  // Derive isRunning and output directly from reactive Convex state (no closures)
  const isRunning = commandRunner.activeRunOutput.run?.status === 'running';
  const output = commandRunner.activeRunOutput.chunks
    .map((c: { content: string }) => c.content)
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

  const close = useCallback(() => {
    stop();
    setCommandName(null);
    setScript(null);
  }, [stop]);

  return {
    commandName,
    script,
    isRunning,
    output,
    run,
    stop,
    close,
  };
}
