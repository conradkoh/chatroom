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
  /** Restored from getAgentStatus / AgentRoleView (defaults to true when absent). */
  teamWantResume?: boolean;
}

// fallow-ignore-next-line complexity
export function useTeamAgentBehaviorSettings({
  chatroomId,
  role,
  teamAutoRestartOnNewContext,
  teamWantResume,
}: UseTeamAgentBehaviorSettingsOptions) {
  const setAutoRestartOnNewContextMutation = useSessionMutation(
    api.machines.setAutoRestartOnNewContext
  );
  const setWantResumeMutation = useSessionMutation(api.machines.setWantResume);

  const [autoRestartOnNewContext, setAutoRestartOnNewContext] = useState(
    teamAutoRestartOnNewContext ?? false
  );
  const [wantResume, setWantResume] = useState(teamWantResume ?? true);
  const [isSavingAutoRestartOnNewContext, setIsSavingAutoRestartOnNewContext] = useState(false);
  const [isSavingWantResume, setIsSavingWantResume] = useState(false);

  useEffect(() => {
    if (!isSavingAutoRestartOnNewContext && teamAutoRestartOnNewContext !== undefined) {
      setAutoRestartOnNewContext(teamAutoRestartOnNewContext);
    }
  }, [teamAutoRestartOnNewContext, isSavingAutoRestartOnNewContext]);

  useEffect(() => {
    if (!isSavingWantResume && teamWantResume !== undefined) {
      setWantResume(teamWantResume);
    }
  }, [teamWantResume, isSavingWantResume]);

  const seedFromTeamConfig = useCallback(
    // fallow-ignore-next-line complexity
    (values?: { autoRestartOnNewContext?: boolean; wantResume?: boolean }) => {
      setAutoRestartOnNewContext(
        values?.autoRestartOnNewContext ?? teamAutoRestartOnNewContext ?? false
      );
      setWantResume(values?.wantResume ?? teamWantResume ?? true);
    },
    [teamAutoRestartOnNewContext, teamWantResume]
  );

  const syncWantResume = useCallback((value: boolean) => {
    setWantResume(value);
  }, []);

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
        toast.error(err instanceof Error ? err.message : 'Failed to update auto-restart setting');
      } finally {
        setIsSavingAutoRestartOnNewContext(false);
      }
    },
    [chatroomId, role, setAutoRestartOnNewContextMutation, teamAutoRestartOnNewContext]
  );

  const updateWantResume = useCallback(
    async (checked: boolean) => {
      setWantResume(checked);
      setIsSavingWantResume(true);
      try {
        await setWantResumeMutation({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          wantResume: checked,
        });
      } catch (err) {
        setWantResume(teamWantResume ?? true);
        toast.error(err instanceof Error ? err.message : 'Failed to update resume setting');
      } finally {
        setIsSavingWantResume(false);
      }
    },
    [chatroomId, role, setWantResumeMutation, teamWantResume]
  );

  return {
    autoRestartOnNewContext,
    effectiveAutoRestartOnNewContext: teamAutoRestartOnNewContext ?? autoRestartOnNewContext,
    updateAutoRestartOnNewContext,
    seedFromTeamConfig,
    isSavingAutoRestartOnNewContext,
    wantResume,
    effectiveWantResume: teamWantResume ?? wantResume,
    updateWantResume,
    syncWantResume,
    isSavingWantResume,
  };
}
