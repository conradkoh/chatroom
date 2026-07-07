'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Settings2, Loader2 } from 'lucide-react';
import React, { useCallback, memo, useEffect, useMemo, useState } from 'react';

import { SetupAgentTeamStep } from './setup/SetupAgentTeamStep';
import { SetupWorkspaceStep } from './setup/SetupWorkspaceStep';
import { useAgentPanelData } from '../hooks/useAgentPanelData';
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

interface Participant {
  role: string;
  lastSeenAt?: number | null;
}

interface SetupChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  /** @deprecated No longer used — kept for caller compatibility */
  teamName?: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  /** @deprecated No longer used — kept for caller compatibility */
  onViewPrompt?: (role: string) => void;
  chatroomName: string;
  onRenameChatroom: (newName: string) => Promise<void>;
  /** @deprecated No longer used — kept for caller compatibility */
  onWorkingDirPasted?: (rawPath: string) => void;
}

type SetupStep = 'workspace' | 'agents';

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
  const {
    connectedMachines,
    machineConfigs,
    isLoading,
    sendCommand,
    agents: agentRoleViews,
  } = useAgentPanelData(chatroomId);
  const { workspaces: chatroomWorkspaces, isLoading: isLoadingWorkspaces } =
    useChatroomWorkspaces(chatroomId);

  useEffect(() => {
    if (!isOpen) return;
    // Wait for workspace registry before choosing initial step (prevents step-1 flash).
    if (isLoadingWorkspaces) return;

    const existing = pickSetupWorkspace(
      chatroomWorkspaces.map((ws) => ({
        machineId: ws.machineId ?? '',
        workingDir: ws.workingDir,
        registeredAt: ws.registeredAt,
      }))
    );
    if (existing) {
      setSetupMachineId(existing.machineId);
      setSetupWorkingDir(existing.workingDir);
      setStep('agents');
      return;
    }

    setStep('workspace');
    setSetupMachineId(null);
    setSetupWorkingDir(null);
  }, [isOpen, isLoadingWorkspaces, chatroomWorkspaces]);

  const joinedCount = useMemo(
    () => countJoinedRoles(teamRoles, participants),
    [teamRoles, participants]
  );

  const handleConfirmWorkspace = useCallback(
    async (machineId: string, workingDir: string) => {
      const machine = connectedMachines.find((m) => m.machineId === machineId);
      await registerWorkspace({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        machineId,
        workingDir,
        hostname: machine?.hostname ?? 'unknown',
        registeredBy: 'user',
      });

      const suggestedName = normalizePastedChatroomName(workingDir);
      if (suggestedName && suggestedName !== chatroomName) {
        await onRenameChatroom(suggestedName);
      }

      setSetupMachineId(machineId);
      setSetupWorkingDir(workingDir);
      setStep('agents');
    },
    [connectedMachines, registerWorkspace, chatroomId, chatroomName, onRenameChatroom]
  );

  const handleBackToWorkspace = useCallback(() => {
    setStep('workspace');
  }, []);

  const handleAllAgentsStarted = useCallback(() => {
    onClose();
  }, [onClose]);

  const { title, description } = STEP_COPY[step];
  const stepSubtitle =
    step === 'workspace' ? 'Step 1 of 2' : `${joinedCount} of ${teamRoles.length} agents ready`;

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-3xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <div className="flex items-center gap-3 min-w-0">
            <Settings2 size={18} className="text-chatroom-status-warning flex-shrink-0" />
            <div className="min-w-0">
              <FixedModalTitle>{title}</FixedModalTitle>
              <p className="text-xs text-chatroom-text-muted mt-0.5 min-h-[1rem]">{stepSubtitle}</p>
            </div>
          </div>
        </FixedModalHeader>

        <div className="flex-shrink-0 px-4 py-3 border-b-2 border-chatroom-border bg-chatroom-bg-tertiary min-h-[3.25rem] flex items-center">
          <p className="text-xs text-chatroom-text-secondary">{description}</p>
        </div>

        <FixedModalBody>
          {isLoadingWorkspaces ? (
            <div className="flex items-center justify-center py-12 text-chatroom-text-muted">
              <Loader2 size={18} className="animate-spin mr-2" />
              <span className="text-sm">Loading workspace...</span>
            </div>
          ) : step === 'workspace' ? (
            <SetupWorkspaceStep
              connectedMachines={connectedMachines}
              isLoadingMachines={isLoading}
              onConfirm={handleConfirmWorkspace}
            />
          ) : setupMachineId && setupWorkingDir ? (
            <SetupAgentTeamStep
              chatroomId={chatroomId}
              teamRoles={teamRoles}
              teamEntryPoint={teamEntryPoint}
              participants={participants}
              machineId={setupMachineId}
              workingDir={setupWorkingDir}
              connectedMachines={connectedMachines}
              isLoadingMachines={isLoading}
              agentConfigs={machineConfigs}
              sendCommand={sendCommand}
              agentRoleViews={agentRoleViews}
              onAllAgentsStarted={handleAllAgentsStarted}
              onBack={handleBackToWorkspace}
            />
          ) : null}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
