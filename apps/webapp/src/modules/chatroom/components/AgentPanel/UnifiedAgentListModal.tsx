'use client';

import { memo, useState, useEffect, useMemo, useCallback, useContext } from 'react';

import { WorkspaceAgentList } from './WorkspaceAgentList';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { useAgentPanelData } from '../../hooks/useAgentPanelData';
import { useAgentStatuses } from '../../hooks/useAgentStatuses';
import { useChatroomWorkspaces } from '../../workspace/hooks/useChatroomWorkspaces';
import type { WorkspaceGroup } from '../../types/workspace';
import type { StatusVariant } from '../../utils/agentStatusLabel';
import { buildWorkspaceGroups } from '../../utils/buildWorkspaceGroups';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
import { PromptsContext } from '@/contexts/PromptsContext';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

/** All Agents modal with workspace sidebar + filtered agent list.
 *  Self-sufficient: fetches agents and prompt data internally.
 *  Works correctly when rendered outside PromptsProvider (prompt defaults to ''). */
export const UnifiedAgentListModal = memo(function UnifiedAgentListModal({
  isOpen,
  onClose,
  chatroomId,
}: UnifiedAgentListModalProps) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

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

  // Flat list for selection lookup (includes unassigned)
  const flatWorkspaces = useMemo(
    () => workspaceGroups.flatMap((g) => g.workspaces),
    [workspaceGroups]
  );

  // Auto-select first workspace whenever workspaces load or current selection is stale
  useEffect(() => {
    if (
      flatWorkspaces.length > 0 &&
      (selectedWorkspaceId === null || !flatWorkspaces.find((w) => w.id === selectedWorkspaceId))
    ) {
      setSelectedWorkspaceId(flatWorkspaces[0].id);
    }
  }, [flatWorkspaces, selectedWorkspaceId]);

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedWorkspaceId(null);
    }
  }, [isOpen]);

  const selectedWorkspace = useMemo(
    () => flatWorkspaces.find((w) => w.id === selectedWorkspaceId) ?? null,
    [flatWorkspaces, selectedWorkspaceId]
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
        <FixedModalBody className="flex flex-col sm:flex-row p-0 overflow-hidden">
          {/* Mobile workspace selector — visible only on small screens */}
          <div className="sm:hidden border-b border-chatroom-border px-3 py-2 flex-shrink-0">
            <Select
              value={selectedWorkspaceId ?? undefined}
              onValueChange={setSelectedWorkspaceId}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaceGroups.map((group) => (
                  <SelectGroup key={group.machineId ?? group.hostname}>
                    <SelectLabel>{group.hostname}</SelectLabel>
                    {group.workspaces.map((ws) => {
                      const dirLabel = ws.workingDir
                        ? (ws.workingDir.split('/').filter(Boolean).pop() ?? ws.workingDir)
                        : '(no directory)';
                      return (
                        <SelectItem key={ws.id} value={ws.id}>
                          {dirLabel}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop sidebar — hidden on mobile */}
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
