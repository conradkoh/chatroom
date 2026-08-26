'use client';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import type { AgentConfig } from '../types/machine';

export function useAgentConfigs(chatroomId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? false;
  const result = useSessionQuery(
    api.machines.getMachineAgentConfigs,
    enabled ? { chatroomId: chatroomId as Id<'chatroom_rooms'> } : 'skip'
  );
  const configs = useMemo<AgentConfig[]>(
    () => (result?.configs ?? []) as AgentConfig[],
    [result?.configs]
  );
  return { configs, isLoading: enabled && result === undefined };
}
