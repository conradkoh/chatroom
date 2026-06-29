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
  /** Restored from getAgentStatus / AgentRoleView (defaults to true when absent). */
  teamWantResume?: boolean;
}

export function useTeamAgentBehaviorSettings({
  chatroomId,
  role,
  teamWantResume,
}: UseTeamAgentBehaviorSettingsOptions) {
  const setWantResumeMutation = useSessionMutation(api.machines.setWantResume);

  const [wantResume, setWantResume] = useState(teamWantResume ?? true);
  const [isSavingWantResume, setIsSavingWantResume] = useState(false);

  useEffect(() => {
    if (!isSavingWantResume && teamWantResume !== undefined) {
      setWantResume(teamWantResume);
    }
  }, [teamWantResume, isSavingWantResume]);

  const seedFromTeamConfig = useCallback(
    (values?: { wantResume?: boolean }) => {
      setWantResume(values?.wantResume ?? teamWantResume ?? true);
    },
    [teamWantResume]
  );

  const syncWantResume = useCallback((value: boolean) => {
    setWantResume(value);
  }, []);

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
    seedFromTeamConfig,
    wantResume,
    effectiveWantResume: teamWantResume ?? wantResume,
    updateWantResume,
    syncWantResume,
    isSavingWantResume,
  };
}
