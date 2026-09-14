'use client';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import type { AgentConfig } from '../types/machine';

export function useAgentConfigs(chatroomId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? false;
  const result = useSessionQuery(
    api.agents.listLastSentLaunchRequests,
    enabled ? { chatroomId: chatroomId as Id<'chatroom_rooms'> } : 'skip'
  );
  const machines = useSessionQuery(api.machines.listMachines);
  const configs = useMemo<AgentConfig[]>(
    () =>
      (result ?? []).map((request) => {
        const machine = machines?.machines.find(
          (candidate) => candidate.machineId === request.machineId
        );
        return {
          machineId: request.machineId,
          hostname: machine?.hostname ?? 'Unknown',
          alias: machine?.alias,
          role: request.role,
          agentType: request.agentHarness,
          workingDir: request.workingDir,
          model: request.model,
          availableHarnesses: (machine?.availableHarnesses ??
            []) as AgentConfig['availableHarnesses'],
          updatedAt: request.requestedAt,
        };
      }),
    [machines?.machines, result]
  );
  return { configs, isLoading: enabled && (result === undefined || machines === undefined) };
}
