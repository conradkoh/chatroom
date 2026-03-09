'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { memo, useMemo, useCallback, useState, useEffect } from 'react';


import type { MachineInfo, AgentConfig } from '../../types/machine';
import type { AgentPreference } from '../AgentConfigTabs';
import type { TeamAgentConfig } from './InlineAgentCard';
import { WorkspaceAgentList } from './WorkspaceAgentList';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { useWorkspaces } from '../../hooks/useWorkspaces';

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

  // Data fetching
  const machinesResult = useSessionQuery(api.machines.listMachines, {}) as
    | { machines: MachineInfo[] }
    | undefined;

  const configsResult = useSessionQuery(api.machines.getMachineAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as { configs: AgentConfig[] } | undefined;

  const teamAgentConfigs = useSessionQuery(api.machines.getTeamAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TeamAgentConfig[] | undefined;

  const agentPreferencesResult = useSessionQuery(api.machines.getAgentPreferences, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as AgentPreference[] | undefined;

  const saveAgentPreference = useSessionMutation(api.machines.saveAgentPreference);
  const sendCommand = useSessionMutation(api.machines.sendCommand);

  const connectedMachines = useMemo(() => {
    if (!machinesResult?.machines) return [];
    return machinesResult.machines.filter((m) => m.daemonConnected);
  }, [machinesResult?.machines]);

  const isLoadingMachines = machinesResult === undefined || configsResult === undefined;

  const agentConfigs = useMemo(() => configsResult?.configs ?? [], [configsResult?.configs]);

  const teamConfigMap = useMemo(() => {
    if (!teamAgentConfigs) return new Map<string, TeamAgentConfig>();
    return new Map(teamAgentConfigs.map((c) => [c.role.toLowerCase(), c]));
  }, [teamAgentConfigs]);

  const agentPreferenceMap = useMemo(() => {
    if (!agentPreferencesResult) return new Map<string, AgentPreference>();
    return new Map(agentPreferencesResult.map((p) => [p.role.toLowerCase(), p]));
  }, [agentPreferencesResult]);

  const handleSavePreference = useCallback(
    (pref: AgentPreference) => {
      saveAgentPreference({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role: pref.role,
        machineId: pref.machineId,
        agentHarness: pref.agentHarness,
        model: pref.model,
        workingDir: pref.workingDir,
      }).catch((err) => {
        console.error('[AgentPanel] Failed to save agent preference:', err);
      });
    },
    [saveAgentPreference, chatroomId]
  );

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
            isLoadingMachines={isLoadingMachines}
            agentConfigs={agentConfigs}
            sendCommand={sendCommand}
            teamConfigMap={teamConfigMap}
            agentPreferenceMap={agentPreferenceMap}
            onSavePreference={handleSavePreference}
          />
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
