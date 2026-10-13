'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { saveChoiceOf, saveScopeOf } from './derivations';
import type { AgentHarness } from '../../types/machine';

import { getErrorMessage } from '@/lib/convexError';

const FEEDBACK_MS = 2000;

/** Saves the selected harness, model and working dir as the role's configuration. */
export function useAgentSaveAction({
  chatroomId,
  workspaceId,
  role,
  selectedMachineId,
  selectedHarness,
  selectedModel,
  workingDir,
  canSave,
  setIsSaving,
  setError,
  setSuccess,
}: {
  chatroomId: string;
  workspaceId?: string;
  role: string;
  selectedMachineId: string | null;
  selectedHarness: AgentHarness | null;
  selectedModel: string | null;
  workingDir: string;
  canSave: boolean;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccess: Dispatch<SetStateAction<string | null>>;
}) {
  const saveAgentConfig = useSessionMutation(api.agents.saveConfig);

  const handleSaveConfig = useCallback(async () => {
    const scope = saveScopeOf(canSave, workspaceId, selectedMachineId);
    const choice = saveChoiceOf(selectedHarness, selectedModel);
    if (!scope || !choice) return;
    setIsSaving(true);
    setError(null);
    try {
      await saveAgentConfig({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        workspaceId: scope.workspaceId as Id<'chatroom_workspaces'>,
        role,
        machineId: scope.machineId,
        agentHarness: choice.harness,
        model: choice.model,
        workingDir: workingDir.trim(),
      });
      setSuccess('Configuration saved!');
      setTimeout(() => setSuccess(null), FEEDBACK_MS);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save configuration'));
    } finally {
      setIsSaving(false);
    }
  }, [
    canSave,
    workspaceId,
    selectedMachineId,
    selectedHarness,
    selectedModel,
    saveAgentConfig,
    chatroomId,
    role,
    workingDir,
    setIsSaving,
    setError,
    setSuccess,
  ]);

  return handleSaveConfig;
}
