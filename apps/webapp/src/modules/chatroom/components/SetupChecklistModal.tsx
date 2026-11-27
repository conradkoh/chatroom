'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Settings2, Loader2 } from 'lucide-react';
import React, { useCallback, memo, useEffect, useMemo, useRef, useState } from 'react';

import { SetupAgentTeamStep } from './setup/SetupAgentTeamStep';
import { SetupWorkspaceStep } from './setup/SetupWorkspaceStep';
import { useChatroomWorkspace } from '../context/ChatroomWorkspaceContext';
import type { SwitchWorkspaceResult } from '../context/ChatroomWorkspaceContext';
import { SwitchWorkspaceFlow } from '../features/switch-workspace/SwitchWorkspaceFlow';
import { useSwitchWorkspaceFlow } from '../features/switch-workspace/useSwitchWorkspaceFlow';
import { useAgentCommandSender } from '../hooks/useAgentCommandSender';
import { useAgentConfigs } from '../hooks/useAgentConfigs';
import type { UserMachine } from '../types/machine';
import { countJoinedRoles } from '../utils/countJoinedRoles';
import { normalizePastedChatroomName } from '../utils/normalizeChatroomName';
import { pickSetupWorkspace } from '../utils/pickSetupWorkspace';
import { useChatroomWorkspaces } from '../workspace/hooks/useChatroomWorkspaces';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';
import { useConnectedMachines } from '@/hooks/useConnectedMachines';
import { useUserMachines } from '@/hooks/useUserMachines';

interface Participant {
  role: string;
  lastSeenAt?: number | null;
}

interface SetupChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  teamId?: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  chatroomName: string;
  onRenameChatroom: (newName: string) => Promise<void>;
}

type SetupStep = 'workspace' | 'agents';

interface SetupMachineConnectivityProps {
  children: (connectedMachines: UserMachine[]) => React.ReactNode;
}

// Keep this helper beneath FixedModal so Base UI unmounts the connectivity subscription
// with the closed dialog instead of keeping it alive on the chatroom page.
const SetupMachineConnectivity = memo(function SetupMachineConnectivity({
  children,
}: SetupMachineConnectivityProps) {
  const { connectedMachines } = useConnectedMachines();

  return <>{children(connectedMachines)}</>;
});

/** A registered workspace, in the shape `pickSetupWorkspace` resumes from. */
function toSetupCandidate(ws: {
  machineId: string | null;
  workingDir: string;
  registeredAt?: number;
}) {
  return {
    machineId: ws.machineId ?? '',
    workingDir: ws.workingDir,
    registeredAt: ws.registeredAt,
  };
}

const STEP_COPY: Record<SetupStep, { title: string; description: string }> = {
  workspace: {
    title: 'Setup Workspace',
    description: 'Select a machine and workspace folder to anchor this chatroom.',
  },
  agents: {
    title: 'Agent Team',
    description: 'Configure harness and model for each agent, then start them all.',
  },
};

// fallow-ignore-next-line complexity
export const SetupChecklistModal = memo(function SetupChecklistModal({
  isOpen,
  onClose,
  chatroomId,
  teamId,
  teamRoles,
  teamEntryPoint,
  participants,
  chatroomName,
  onRenameChatroom,
}: SetupChecklistModalProps) {
  const [step, setStep] = useState<SetupStep>('workspace');
  const [setupMachineId, setSetupMachineId] = useState<string | null>(null);
  const [setupWorkingDir, setSetupWorkingDir] = useState<string | null>(null);

  const registerWorkspace = useSessionMutation(api.workspaces.registerWorkspace);
  const { isLoading: isLoadingMachines } = useUserMachines();
  const { configs: machineConfigs, isLoading: isLoadingConfigs } = useAgentConfigs(chatroomId, {
    enabled: true,
  });
  const sendCommand = useAgentCommandSender();
  const { workspaces: chatroomWorkspaces, isLoading: isLoadingWorkspaces } =
    useChatroomWorkspaces(chatroomId);

  const { activeWorkspace } = useChatroomWorkspace();
  const switchFlow = useSwitchWorkspaceFlow();
  const switchInProgress = switchFlow.stage === 'submitting' || switchFlow.stage === 'done';
  // Read inside the effect without making it a dependency: a switch that finishes must not re-route.
  const switchInProgressRef = useRef(false);
  switchInProgressRef.current = switchInProgress;
  // Mirrors `step` for the routing effect below. Read in the effect, not a dependency, so the effect does not re-run on every step change.
  const stepRef = useRef<SetupStep>(step);
  stepRef.current = step;
  // True once this open session has routed the step. Reset when the modal closes.
  const routedRef = useRef(false);
  const hasActiveWorkspace = activeWorkspace !== null;

  const existingWorkspace = useMemo(
    () => pickSetupWorkspace(chatroomWorkspaces.map(toSetupCandidate)),
    [chatroomWorkspaces]
  );
  const existingMachineId = existingWorkspace?.machineId ?? null;
  const existingWorkingDir = existingWorkspace?.workingDir ?? null;

  useEffect(() => {
    if (!isOpen) {
      routedRef.current = false;
      return;
    }
    // Wait for workspace registry before choosing initial step (prevents step-1 flash).
    if (isLoadingWorkspaces) return;
    // A switch that is submitting or showing its Result owns the step.
    if (switchInProgressRef.current) return;
    // After the first routing, a live change while Choose or Review is showing on a bound chatroom
    // stays on the switch flow. Its conflict rule shows the change; re-routing would drop the review.
    if (routedRef.current && stepRef.current === 'workspace' && hasActiveWorkspace) return;
    routedRef.current = true;
    // An empty machine id cannot anchor the agent team, so it routes to the workspace step.
    if (existingMachineId && existingWorkingDir) {
      setSetupMachineId(existingMachineId);
      setSetupWorkingDir(existingWorkingDir);
      setStep('agents');
      return;
    }
    setStep('workspace');
    setSetupMachineId(null);
    setSetupWorkingDir(null);
  }, [isOpen, isLoadingWorkspaces, existingMachineId, existingWorkingDir, hasActiveWorkspace]);

  const joinedCount = useMemo(
    () => countJoinedRoles(teamRoles, participants),
    [teamRoles, participants]
  );

  const handleConfirmWorkspace = useCallback(
    // fallow-ignore-next-line complexity
    async (machineId: string, workingDir: string, connectedMachines: UserMachine[]) => {
      // registerWorkspace is only reached with no active workspace; a bound chatroom switches instead.
      const machine = connectedMachines.find((m) => m.machineId === machineId);
      await registerWorkspace({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        machineId,
        workingDir,
        hostname: machine?.hostname ?? 'unknown',
        registeredBy: 'user',
      });

      // Route before the rename: a failed rename must not strand the user on the workspace step.
      setSetupMachineId(machineId);
      setSetupWorkingDir(workingDir);
      setStep('agents');

      const suggestedName = normalizePastedChatroomName(workingDir);
      if (suggestedName && suggestedName !== chatroomName) {
        await onRenameChatroom(suggestedName);
      }
    },
    [registerWorkspace, chatroomId, chatroomName, onRenameChatroom]
  );

  const handleBackToWorkspace = useCallback(() => {
    setStep('workspace');
  }, []);

  // Where Cancel on the Choose stage returns to. Prefers the live workspace, then the routed one.
  // With no usable target, Cancel is not offered.
  const cancelTarget = useMemo(() => {
    if (activeWorkspace?.machineId && activeWorkspace.workingDir) {
      return { machineId: activeWorkspace.machineId, workingDir: activeWorkspace.workingDir };
    }
    if (existingMachineId && existingWorkingDir) {
      return { machineId: existingMachineId, workingDir: existingWorkingDir };
    }
    return null;
  }, [activeWorkspace, existingMachineId, existingWorkingDir]);

  const handleSwitchCancel = useCallback(() => {
    if (!cancelTarget) return;
    setSetupMachineId(cancelTarget.machineId);
    setSetupWorkingDir(cancelTarget.workingDir);
    setStep('agents');
  }, [cancelTarget]);

  const { reset: resetSwitchFlow } = switchFlow;
  const handleSwitchDone = useCallback(
    (result: SwitchWorkspaceResult) => {
      setSetupMachineId(result.machineId);
      setSetupWorkingDir(result.workingDir);
      resetSwitchFlow();
      setStep('agents');
    },
    [resetSwitchFlow]
  );

  const handleAllAgentsStarted = useCallback(() => {
    onClose();
  }, [onClose]);

  // The modal close is ignored while a switch is submitting.
  const handleRequestClose = useCallback(() => {
    if (switchFlow.busy) return;
    onClose();
  }, [onClose, switchFlow.busy]);

  const switching = step === 'workspace' && activeWorkspace !== null;
  const { title, description } = switching
    ? {
        title: 'Switch Workspace',
        description: 'Move this chatroom to a different machine or folder.',
      }
    : STEP_COPY[step];
  const stepSubtitle = switching
    ? switchFlow.stage === 'done'
      ? 'Done'
      : 'Step 1 of 2'
    : step === 'workspace'
      ? 'Step 1 of 2'
      : `${joinedCount} of ${teamRoles.length} agents ready`;

  return (
    <FixedModal isOpen={isOpen} onClose={handleRequestClose} maxWidth="max-w-2xl">
      <SetupMachineConnectivity>
        {/* fallow-ignore-next-line complexity */}
        {(connectedMachines) => (
          <FixedModalContent>
            <FixedModalHeader onClose={switchFlow.busy ? undefined : handleRequestClose}>
              <div className="flex items-center gap-3 min-w-0">
                <Settings2 size={18} className="text-chatroom-status-warning flex-shrink-0" />
                <div className="min-w-0">
                  <FixedModalTitle>{title}</FixedModalTitle>
                  <p className="text-xs text-chatroom-text-muted mt-0.5 min-h-[1rem]">
                    {stepSubtitle}
                  </p>
                </div>
              </div>
            </FixedModalHeader>

            <div className="flex shrink-0 items-center border-b-2 border-chatroom-border bg-chatroom-bg-tertiary px-4 py-2 sm:px-6">
              <p className="text-xs text-chatroom-text-secondary">{description}</p>
            </div>

            <FixedModalBody className="flex flex-col overflow-hidden">
              {isLoadingWorkspaces ? (
                <div className="flex flex-1 items-center justify-center py-12 text-chatroom-text-muted">
                  <Loader2 size={18} className="animate-spin mr-2" />
                  <span className="text-sm">Loading workspace...</span>
                </div>
              ) : step === 'workspace' ? (
                activeWorkspace !== null ? (
                  <SwitchWorkspaceFlow
                    flow={switchFlow}
                    doneLabel="Continue to agent team"
                    onCancel={cancelTarget ? handleSwitchCancel : undefined}
                    onDone={handleSwitchDone}
                  />
                ) : (
                  <SetupWorkspaceStep
                    connectedMachines={connectedMachines}
                    isLoadingMachines={isLoadingMachines}
                    onConfirm={(machineId, workingDir) =>
                      handleConfirmWorkspace(machineId, workingDir, connectedMachines)
                    }
                  />
                )
              ) : setupMachineId && setupWorkingDir ? (
                <SetupAgentTeamStep
                  chatroomId={chatroomId}
                  teamId={teamId}
                  teamRoles={teamRoles}
                  teamEntryPoint={teamEntryPoint}
                  participants={participants}
                  machineId={setupMachineId}
                  workingDir={setupWorkingDir}
                  machines={connectedMachines}
                  isLoadingMachines={isLoadingMachines || isLoadingConfigs}
                  agentConfigs={machineConfigs}
                  sendCommand={sendCommand}
                  onAllAgentsStarted={handleAllAgentsStarted}
                  onBack={handleBackToWorkspace}
                  autoFocusFirstControl={false}
                />
              ) : null}
            </FixedModalBody>
          </FixedModalContent>
        )}
      </SetupMachineConnectivity>
    </FixedModal>
  );
});
