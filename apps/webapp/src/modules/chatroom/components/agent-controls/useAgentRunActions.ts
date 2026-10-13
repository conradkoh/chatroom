'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { isRehomeNeeded, restartModelFor, startCommandOf, workspaceField } from './derivations';
import type { useMachineConfigUsage } from '../../features/machine-config/hooks/useMachineConfigUsage';
import type { useAgentStop } from '../../hooks/useAgentStop';
import type { AgentConfig, AgentHarness, SendCommandFn } from '../../types/machine';
import { dispatchStartAgent } from '../../utils/agentStart';

import { getErrorMessage } from '@/lib/convexError';

const FEEDBACK_MS = 2000;

/** Records usage of the harness and model that a start used, when both are set. */
function recordStartUsage(
  record: ReturnType<typeof useMachineConfigUsage>['recordUsage'],
  harness: AgentHarness | null,
  model: string | null
): void {
  if (harness && model) record({ agentHarness: harness, model });
}

export interface AgentRunActionInputs {
  chatroomId: string;
  workspaceId?: string;
  role: string;
  selectedMachineId: string | null;
  selectedHarness: AgentHarness | null;
  selectedModel: string | null;
  workingDir: string;
  displayAgentConfig: AgentConfig | undefined;
  teamConfigMachineId?: string | null;
  sendCommand: SendCommandFn;
  requestAgentStop: ReturnType<typeof useAgentStop>['requestAgentStop'];
  recordMachineConfigUsage: ReturnType<typeof useMachineConfigUsage>['recordUsage'];
  setIsStarting: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccess: Dispatch<SetStateAction<string | null>>;
  setIsStopSubmitting: Dispatch<SetStateAction<boolean>>;
  setRehomeConfirmOpen: Dispatch<SetStateAction<boolean>>;
}

/** Start, rehome, stop and restart. Each action reports its outcome through error and success. */
export function useAgentRunActions(inputs: AgentRunActionInputs) {
  const {
    chatroomId,
    workspaceId,
    role,
    selectedMachineId,
    selectedHarness,
    selectedModel,
    workingDir,
    displayAgentConfig,
    teamConfigMachineId,
    sendCommand,
    requestAgentStop,
    recordMachineConfigUsage,
    setIsStarting,
    setError,
    setSuccess,
    setIsStopSubmitting,
    setRehomeConfirmOpen,
  } = inputs;

  const executeStartAgent = useCallback(
    async (allowNewMachine?: boolean) => {
      if (!selectedMachineId || !selectedHarness) return;
      setIsStarting(true);
      setError(null);
      try {
        await dispatchStartAgent(
          sendCommand,
          startCommandOf({
            machineId: selectedMachineId,
            chatroomId,
            workspaceId,
            role,
            model: selectedModel,
            agentHarness: selectedHarness,
            workingDir,
            allowNewMachine,
          })
        );
        recordStartUsage(recordMachineConfigUsage, selectedHarness, selectedModel);
        setSuccess('Start command sent!');
        setTimeout(() => setSuccess(null), FEEDBACK_MS);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to start agent'));
      } finally {
        setIsStarting(false);
      }
    },
    [
      selectedMachineId,
      selectedHarness,
      selectedModel,
      workingDir,
      sendCommand,
      chatroomId,
      workspaceId,
      role,
      recordMachineConfigUsage,
      setIsStarting,
      setError,
      setSuccess,
    ]
  );

  const handleStartAgent = useCallback(() => {
    if (!selectedMachineId || !selectedHarness) return;
    if (isRehomeNeeded(teamConfigMachineId, selectedMachineId)) {
      setRehomeConfirmOpen(true);
      return;
    }
    void executeStartAgent();
  }, [
    selectedMachineId,
    selectedHarness,
    teamConfigMachineId,
    executeStartAgent,
    setRehomeConfirmOpen,
  ]);

  const handleConfirmRehomeStart = useCallback(() => {
    setRehomeConfirmOpen(false);
    void executeStartAgent(true);
  }, [executeStartAgent, setRehomeConfirmOpen]);

  const handleCancelRehomeStart = useCallback(() => {
    setRehomeConfirmOpen(false);
  }, [setRehomeConfirmOpen]);

  const handleStopAgent = useCallback(async () => {
    if (!displayAgentConfig) return;
    setError(null);
    try {
      setIsStopSubmitting(true);
      await requestAgentStop({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        machineId: displayAgentConfig.machineId,
        role,
        workingDir: displayAgentConfig.workingDir,
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to stop agent'));
    } finally {
      setIsStopSubmitting(false);
    }
  }, [displayAgentConfig, requestAgentStop, chatroomId, role, setError, setIsStopSubmitting]);

  const handleRestartAgent = useCallback(async () => {
    if (!displayAgentConfig) return;
    const model = restartModelFor(displayAgentConfig, selectedModel);
    if (!model) {
      setError('Cannot restart agent: model is required');
      return;
    }
    setIsStarting(true);
    setError(null);
    try {
      await sendCommand({
        machineId: displayAgentConfig.machineId,
        type: 'restart-agent',
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          ...workspaceField(workspaceId),
          role,
          model,
          agentHarness: displayAgentConfig.agentType,
          workingDir: displayAgentConfig.workingDir,
        },
      });
      setSuccess('Restart command sent!');
      setTimeout(() => setSuccess(null), FEEDBACK_MS);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to restart agent'));
    } finally {
      setIsStarting(false);
    }
  }, [
    displayAgentConfig,
    selectedModel,
    sendCommand,
    chatroomId,
    workspaceId,
    role,
    setError,
    setIsStarting,
    setSuccess,
  ]);

  return {
    handleStartAgent,
    handleConfirmRehomeStart,
    handleCancelRehomeStart,
    handleStopAgent,
    handleRestartAgent,
  };
}
