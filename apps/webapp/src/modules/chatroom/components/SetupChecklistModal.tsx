'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { X, Settings2 } from 'lucide-react';
import React, { useCallback, memo, useEffect, useMemo, useState } from 'react';

import { SetupAgentTeamStep } from './setup/SetupAgentTeamStep';
import { SetupWorkspaceStep } from './setup/SetupWorkspaceStep';
import { useAgentPanelData } from '../hooks/useAgentPanelData';
import { countJoinedRoles } from '../utils/countJoinedRoles';
import { normalizePastedChatroomName } from '../utils/normalizeChatroomName';

interface Participant {
  role: string;
  lastSeenAt?: number | null;
}

interface SetupChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  onViewPrompt: (role: string) => void;
  chatroomName: string;
  onRenameChatroom: (newName: string) => Promise<void>;
  onWorkingDirPasted?: (rawPath: string) => void;
}

type SetupStep = 'workspace' | 'agents';

// fallow-ignore-next-line complexity
export const SetupChecklistModal = memo(function SetupChecklistModal({
  isOpen,
  onClose,
  chatroomId,
  teamName: _teamName,
  teamRoles,
  teamEntryPoint,
  participants,
  onViewPrompt: _onViewPrompt,
  chatroomName,
  onRenameChatroom,
  onWorkingDirPasted: _onWorkingDirPasted,
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

  useEffect(() => {
    if (isOpen) {
      setStep('workspace');
      setSetupMachineId(null);
      setSetupWorkingDir(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  // fallow-ignore-next-line code-duplication
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  if (!isOpen) return null;

  const stepTitle = step === 'workspace' ? 'Setup Workspace' : 'Agent Team';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="chatroom-root w-full max-w-3xl max-h-[90vh] flex flex-col bg-chatroom-bg-primary border-2 border-chatroom-border-strong overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Settings2 size={18} className="text-chatroom-status-warning" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
                {stepTitle}
              </h2>
            </div>
            {step === 'agents' && (
              <span className="text-xs text-chatroom-text-muted">
                {joinedCount} of {teamRoles.length} agents ready
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
            title="Dismiss setup (you can always access setup from the sidebar)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b-2 border-chatroom-border bg-chatroom-bg-tertiary">
          <p className="text-xs text-chatroom-text-secondary">
            {step === 'workspace'
              ? 'Select a machine and workspace folder to anchor this chatroom.'
              : 'Configure harness and model for each agent, then start them all.'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {step === 'workspace' ? (
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
        </div>
      </div>
    </div>
  );
});
