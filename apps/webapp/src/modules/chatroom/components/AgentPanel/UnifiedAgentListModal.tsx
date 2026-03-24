'use client';

import { memo, useEffect, useMemo, useCallback, useContext } from 'react';

import { WorkspaceAgentList } from './WorkspaceAgentList';
import { useAgentPanelData } from '../../hooks/useAgentPanelData';
import { useAgentStatuses } from '../../hooks/useAgentStatuses';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useChatroomWorkspaces } from '../../workspace/hooks/useChatroomWorkspaces';
import type { WorkspaceGroup } from '../../types/workspace';
import type { StatusVariant } from '../../utils/agentStatusLabel';
import { buildWorkspaceGroups } from '../../utils/buildWorkspaceGroups';
import { WorkspaceDropdown } from '../WorkspaceDropdown';
import { ALL_WORKSPACES } from '../../hooks/useWorkspaceSelection';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
import { PromptsContext } from '@/contexts/PromptsContext';

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
  chatroomId: string;
}

/** All Agents modal with dropdown workspace selector + filtered agent list.
 *  Self-sufficient: fetches agents and prompt data internally.
 *  Works correctly when rendered outside PromptsProvider (prompt defaults to ''). */
export const UnifiedAgentListModal = memo(function UnifiedAgentListModal({
  isOpen,
  onClose,
  chatroomId,
}: UnifiedAgentListModalProps) {
  const {
    agents: agentRoleViews,
    teamRoles,
    connectedMachines,
    machineConfigs,
    agentPreferenceMap,
    isLoading,
    sendCommand,
    savePreference,
  } = useAgentPanelData(chatroomId);

  // Fetch live agent statuses from event stream
  const { agents: agentStatusList } = useAgentStatuses(chatroomId, teamRoles);

  // Build the agents list from live statuses
  const agents = useMemo(
    (): AgentWithStatus[] =>
      agentStatusList.map(({ role, online, lastSeenAt, latestEventType, statusVariant }) => ({
        role,
        online,
        lastSeenAt,
        latestEventType,
        statusVariant,
      })),
    [agentStatusList]
  );

  // Safe prompt generation — works inside and outside PromptsProvider.
  // useContext does not throw when context is null.
  const promptsContext = useContext(PromptsContext);
  const generatePrompt = useCallback(
    (role: string): string => promptsContext?.getAgentPrompt(role) ?? '',
    [promptsContext]
  );

  // Workspace list from registry, enriched with agent roles
  const { workspaces: allWorkspaces } = useChatroomWorkspaces(chatroomId, {
    agentViews: agentRoleViews,
  });

  // Derive workspace groups from flat list (group by hostname)
  const workspaceGroups = useMemo(
    (): WorkspaceGroup[] => buildWorkspaceGroups(allWorkspaces, agents),
    [allWorkspaces, agents]
  );

  // Workspace selection (shared hook — eliminates duplicated selection logic)
  const {
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedWorkspace,
    flatWorkspaces,
  } = useWorkspaceSelection(workspaceGroups);

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedWorkspaceId(ALL_WORKSPACES);
    }
  }, [isOpen, setSelectedWorkspaceId]);

  // When a specific workspace is selected, pass it to WorkspaceAgentList.
  // When "All" is selected, we render one WorkspaceAgentList per workspace.
  const visibleWorkspaces = useMemo(() => {
    if (selectedWorkspace) return [selectedWorkspace];
    return flatWorkspaces;
  }, [selectedWorkspace, flatWorkspaces]);

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
        <FixedModalBody className="flex flex-col p-0 overflow-hidden">
          {/* Workspace selector */}
          <div className="border-b border-chatroom-border px-3 py-2 flex-shrink-0">
            <WorkspaceDropdown
              workspaceGroups={workspaceGroups}
              selectedWorkspaceId={selectedWorkspaceId}
              onSelectWorkspace={setSelectedWorkspaceId}
              showAllOption={true}
              totalAgents={agents.length}
            />
          </div>

          {/* Agent list — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {visibleWorkspaces.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-xs text-chatroom-text-muted uppercase tracking-wide">
                  No workspaces or agents configured
                </p>
              </div>
            ) : (
              visibleWorkspaces.map((ws) => (
                <WorkspaceAgentList
                  key={ws.id}
                  workspace={ws}
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
              ))
            )}
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
