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

import { useCallback, useState } from 'react';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';

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
