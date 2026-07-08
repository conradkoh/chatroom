/**
 * useCommandRunner — hook for discovering, running, and managing workspace commands.
 *
 * Provides:
 * - List of available commands from package.json/turbo.json
 * - Run a command
 * - Stop a running command
 * - List of recent command runs
 * - Output for a specific run
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useState } from 'react';

import type { CommandRun } from '../features/run-command/types/run';
import { isActiveRun } from '../features/run-command/utils/run-status';

export interface UseCommandRunnerProps {
  machineId: string | null;
  workingDir: string | null;
}

export function useCommandRunner({ machineId, workingDir }: UseCommandRunnerProps) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // Queries
  const commands = useSessionQuery(
    api.commands.listCommands,
    machineId && workingDir ? { machineId, workingDir } : 'skip'
  );

  const runsQuery = useSessionQuery(
    api.commands.listRunsV2,
    machineId && workingDir ? { machineId, workingDir } : 'skip'
  );

  const runs = useMemo(() => (runsQuery ?? []) as CommandRun[], [runsQuery]);

  // Mutations
  const runCommandMutation = useSessionMutation(api.commands.runCommand);
  const stopCommandMutation = useSessionMutation(api.commands.stopCommand);

  const runCommand = useCallback(
    async (commandName: string, script: string) => {
      if (!machineId || !workingDir) return null;

      // Always dispatch a fresh runCommand — the backend handles replace semantics
      // (kills any currently-running process for the same command name + workingDir)
      // and protects against double-clicks via the 1-second back-to-back dedup window.
      const runId = await runCommandMutation({
        machineId,
        workingDir,
        commandName,
        script,
      });
      setActiveRunId(runId);
      return runId;
    },
    [machineId, workingDir, runCommandMutation]
  );

  const runOrAttach = useCallback(
    async (commandName: string, script: string) => {
      if (!machineId || !workingDir) return null;

      const existingRun = runs.find(
        (run) => run.commandName === commandName && isActiveRun(run.status)
      );
      if (existingRun) {
        setActiveRunId(existingRun._id);
        return existingRun._id;
      }

      return runCommand(commandName, script);
    },
    [machineId, workingDir, runs, runCommand]
  );

  const stopCommand = useCallback(
    async (runId: string) => {
      if (!machineId) return;
      await stopCommandMutation({ machineId, runId: runId as any });
    },
    [machineId, stopCommandMutation]
  );

  return {
    commands: commands ?? [],
    runs,
    activeRunId,
    setActiveRunId,
    runCommand,
    runOrAttach,
    stopCommand,
  };
}
