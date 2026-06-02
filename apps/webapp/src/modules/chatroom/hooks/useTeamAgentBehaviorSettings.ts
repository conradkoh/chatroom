'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Per-role team agent behavior toggles persisted on `chatroom_teamAgentConfigs`.
 *
 * Single place for optimistic local state, Convex restore (from getAgentStatus),
 * and save mutations. Consumers should use `effective*` for display when a
 * server snapshot is available.
 */
export interface UseTeamAgentBehaviorSettingsOptions {
  chatroomId: string;
  role: string;
  /** Restored from getAgentStatus / AgentRoleView */
  teamAutoRestartOnNewContext?: boolean;
}

export function useTeamAgentBehaviorSettings({
  chatroomId,
  role,
  teamAutoRestartOnNewContext,
}: UseTeamAgentBehaviorSettingsOptions) {
  const setAutoRestartOnNewContextMutation = useSessionMutation(
    api.machines.setAutoRestartOnNewContext
  );

  const [autoRestartOnNewContext, setAutoRestartOnNewContext] = useState(
    teamAutoRestartOnNewContext ?? false
  );
  const [isSavingAutoRestartOnNewContext, setIsSavingAutoRestartOnNewContext] = useState(false);

  useEffect(() => {
    if (!isSavingAutoRestartOnNewContext && teamAutoRestartOnNewContext !== undefined) {
      setAutoRestartOnNewContext(teamAutoRestartOnNewContext);
    }
  }, [teamAutoRestartOnNewContext, isSavingAutoRestartOnNewContext]);

  const seedFromTeamConfig = useCallback(
    (values?: { autoRestartOnNewContext?: boolean }) => {
      setAutoRestartOnNewContext(
        values?.autoRestartOnNewContext ?? teamAutoRestartOnNewContext ?? false
      );
    },
    [teamAutoRestartOnNewContext]
  );

  const updateAutoRestartOnNewContext = useCallback(
    async (checked: boolean) => {
      setAutoRestartOnNewContext(checked);
      setIsSavingAutoRestartOnNewContext(true);
      try {
        await setAutoRestartOnNewContextMutation({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          enabled: checked,
        });
      } catch (err) {
        setAutoRestartOnNewContext(teamAutoRestartOnNewContext ?? false);
        toast.error(
          err instanceof Error ? err.message : 'Failed to update auto-restart setting'
        );
      } finally {
        setIsSavingAutoRestartOnNewContext(false);
      }
    },
    [chatroomId, role, setAutoRestartOnNewContextMutation, teamAutoRestartOnNewContext]
  );

  return {
    autoRestartOnNewContext,
    effectiveAutoRestartOnNewContext: teamAutoRestartOnNewContext ?? autoRestartOnNewContext,
    updateAutoRestartOnNewContext,
    seedFromTeamConfig,
    isSavingAutoRestartOnNewContext,
  };
}
