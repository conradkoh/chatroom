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
 * server snapshot is available, and plain fields for start-agent payloads.
 */
export interface UseTeamAgentBehaviorSettingsOptions {
  chatroomId: string;
  role: string;
  /** Restored from getAgentStatus / AgentRoleView */
  teamWantResumeOnFail?: boolean;
  teamAutoRestartOnNewContext?: boolean;
}

export function useTeamAgentBehaviorSettings({
  chatroomId,
  role,
  teamWantResumeOnFail,
  teamAutoRestartOnNewContext,
}: UseTeamAgentBehaviorSettingsOptions) {
  const setWantResumeOnFailMutation = useSessionMutation(api.machines.setWantResumeOnFail);
  const setAutoRestartOnNewContextMutation = useSessionMutation(
    api.machines.setAutoRestartOnNewContext
  );

  const [wantResumeOnFail, setWantResumeOnFail] = useState(teamWantResumeOnFail ?? true);
  const [autoRestartOnNewContext, setAutoRestartOnNewContext] = useState(
    teamAutoRestartOnNewContext ?? false
  );
  const [isSavingWantResumeOnFail, setIsSavingWantResumeOnFail] = useState(false);
  const [isSavingAutoRestartOnNewContext, setIsSavingAutoRestartOnNewContext] = useState(false);

  useEffect(() => {
    if (!isSavingWantResumeOnFail && teamWantResumeOnFail !== undefined) {
      setWantResumeOnFail(teamWantResumeOnFail);
    }
  }, [teamWantResumeOnFail, isSavingWantResumeOnFail]);

  useEffect(() => {
    if (!isSavingAutoRestartOnNewContext && teamAutoRestartOnNewContext !== undefined) {
      setAutoRestartOnNewContext(teamAutoRestartOnNewContext);
    }
  }, [teamAutoRestartOnNewContext, isSavingAutoRestartOnNewContext]);

  const seedFromTeamConfig = useCallback(
    (values?: { wantResumeOnFail?: boolean; autoRestartOnNewContext?: boolean }) => {
      setWantResumeOnFail(values?.wantResumeOnFail ?? teamWantResumeOnFail ?? true);
      setAutoRestartOnNewContext(
        values?.autoRestartOnNewContext ?? teamAutoRestartOnNewContext ?? false
      );
    },
    [teamAutoRestartOnNewContext, teamWantResumeOnFail]
  );

  const updateWantResumeOnFail = useCallback(
    async (checked: boolean) => {
      setWantResumeOnFail(checked);
      setIsSavingWantResumeOnFail(true);
      try {
        await setWantResumeOnFailMutation({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          enabled: checked,
        });
      } catch (err) {
        setWantResumeOnFail(teamWantResumeOnFail ?? true);
        toast.error(
          err instanceof Error ? err.message : 'Failed to update resume-on-failure setting'
        );
      } finally {
        setIsSavingWantResumeOnFail(false);
      }
    },
    [chatroomId, role, setWantResumeOnFailMutation, teamWantResumeOnFail]
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
    wantResumeOnFail,
    autoRestartOnNewContext,
    effectiveWantResumeOnFail: teamWantResumeOnFail ?? wantResumeOnFail,
    effectiveAutoRestartOnNewContext: teamAutoRestartOnNewContext ?? autoRestartOnNewContext,
    updateWantResumeOnFail,
    updateAutoRestartOnNewContext,
    seedFromTeamConfig,
    isSavingWantResumeOnFail,
    isSavingAutoRestartOnNewContext,
  };
}
