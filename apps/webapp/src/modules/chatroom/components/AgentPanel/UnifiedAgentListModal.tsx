'use client';

import { memo, useState, useEffect, useMemo } from 'react';

import { WorkspaceAgentList } from './WorkspaceAgentList';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { useAgentPanelData } from '../../hooks/useAgentPanelData';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';

export interface AgentWithStatus {
  role: string;
  online: boolean;
  lastSeenAt?: number | null;
  latestEventType?: string | null;
  isStuck?: boolean;
}

interface UnifiedAgentListModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentWithStatus[];
  generatePrompt: (role: string) => string;
  chatroomId: string;
  onViewPrompt?: (role: string) => void;
}

/** All Agents modal with workspace sidebar + filtered agent list. */
export const UnifiedAgentListModal = memo(function UnifiedAgentListModal({
  isOpen,
  onClose,
  agents,
  generatePrompt,
  chatroomId,
}: UnifiedAgentListModalProps) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const {
    connectedMachines,
    machineConfigs,
    teamConfigMap,
    agentPreferenceMap,
    isLoading,
    sendCommand,
    savePreference,
  } = useAgentPanelData(chatroomId);

  // Derive workspace structure from agents + teamConfigMap + connectedMachines
  const { workspaceGroups, allWorkspaces } = useWorkspaces({
    agents,
    teamConfigMap,
    connectedMachines,
  });

  // Auto-select first workspace whenever workspaces load or current selection is stale
  useEffect(() => {
    if (
      allWorkspaces.length > 0 &&
      (selectedWorkspaceId === null || !allWorkspaces.find((w) => w.id === selectedWorkspaceId))
    ) {
      setSelectedWorkspaceId(allWorkspaces[0].id);
    }
  }, [allWorkspaces, selectedWorkspaceId]);

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedWorkspaceId(null);
    }
  }, [isOpen]);

  const selectedWorkspace = useMemo(
    () => allWorkspaces.find((w) => w.id === selectedWorkspaceId) ?? null,
    [allWorkspaces, selectedWorkspaceId]
  );

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>All Agents ({agents.length})</FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody className="flex flex-row p-0 overflow-hidden">
          <WorkspaceSidebar
            workspaceGroups={workspaceGroups}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelectWorkspace={setSelectedWorkspaceId}
          />
          <WorkspaceAgentList
            workspace={selectedWorkspace}
            agents={agents}
            generatePrompt={generatePrompt}
            chatroomId={chatroomId}
            connectedMachines={connectedMachines}
            isLoadingMachines={isLoading}
            agentConfigs={machineConfigs}
            sendCommand={sendCommand}
            teamConfigMap={teamConfigMap}
            agentPreferenceMap={agentPreferenceMap}
            onSavePreference={savePreference}
          />
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
