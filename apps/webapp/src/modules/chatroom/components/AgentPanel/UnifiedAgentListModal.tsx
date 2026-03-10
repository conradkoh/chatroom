'use client';

import { memo, useState, useEffect, useMemo } from 'react';

import { WorkspaceAgentList } from './WorkspaceAgentList';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { useAgentPanelData } from '../../hooks/useAgentPanelData';
import type { StatusVariant } from '../../utils/agentStatusLabel';

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
  desiredState?: string | null;
  statusVariant?: StatusVariant;
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
    agents: agentRoleViews,
    workspaces: backendWorkspaces,
    connectedMachines,
    machineConfigs,
    agentPreferenceMap,
    isLoading,
    sendCommand,
    savePreference,
  } = useAgentPanelData(chatroomId);

  const { workspaceGroups, allWorkspaces } = useWorkspaces({
    agents,
    backendWorkspaces,
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

  // Build a map from role → AgentRoleView for passing to WorkspaceAgentList
  const agentRoleViewMap = useMemo(
    () => new Map(agentRoleViews.map((a) => [a.role.toLowerCase(), a])),
    [agentRoleViews]
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
            agentRoleViewMap={agentRoleViewMap}
            agentPreferenceMap={agentPreferenceMap}
            onSavePreference={savePreference}
          />
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
