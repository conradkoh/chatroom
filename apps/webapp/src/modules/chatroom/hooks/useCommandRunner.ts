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
import { useCallback, useState } from 'react';

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

  const runs = useSessionQuery(
    api.commands.listRuns,
    machineId && workingDir ? { machineId, workingDir } : 'skip'
  );

  const activeRunOutput = useSessionQuery(
    api.commands.getRunOutput,
    activeRunId ? { runId: activeRunId as any } : 'skip'
  );

  // Mutations
  const runCommandMutation = useSessionMutation(api.commands.runCommand);
  const stopCommandMutation = useSessionMutation(api.commands.stopCommand);

  const runCommand = useCallback(
    async (commandName: string, script: string) => {
      if (!machineId || !workingDir) return null;

      // Check if there's already a running command with the same name
      // If so, focus the existing run instead of starting a new one
      const existingRun = (runs ?? []).find(
        (r) => r.commandName === commandName && r.status === 'running'
      );
      if (existingRun) {
        setActiveRunId(existingRun._id);
        return existingRun._id;
      }

      // No existing running command - start a new one
      const runId = await runCommandMutation({
        machineId,
        workingDir,
        commandName,
        script,
      });
      setActiveRunId(runId);
      return runId;
    },
    [machineId, workingDir, runCommandMutation, runs]
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
    runs: runs ?? [],
    activeRunId,
    setActiveRunId,
    activeRunOutput: activeRunOutput ?? { chunks: [], run: null },
    runCommand,
    stopCommand,
  };
}
