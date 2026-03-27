'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { memo, useMemo, useCallback, useContext } from 'react';

import { InlineAgentCard } from './InlineAgentCard';
import { useAgentPanelData } from '../../hooks/useAgentPanelData';
import { useAgentStatuses } from '../../hooks/useAgentStatuses';
import type { StatusVariant } from '../../utils/agentStatusLabel';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
import { PromptsContext } from '@/contexts/PromptsContext';

interface AgentWithStatus {
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

/** All Agents modal — flat role-based agent list.
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
    machineConfigs: agentConfigs,
    agentPreferenceMap,
    isLoading: isPanelLoading,
    sendCommand,
    savePreference,
  } = useAgentPanelData(chatroomId);

  // Fetch live agent statuses from event stream
  const { agents: agentStatusList } = useAgentStatuses(chatroomId, teamRoles);

  // Build the agents list from live statuses (kept for the header count)
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
  const promptsContext = useContext(PromptsContext);
  const generatePrompt = useCallback(
    (role: string): string => promptsContext?.getAgentPrompt(role) ?? '',
    [promptsContext]
  );

  // Build a map from role → AgentRoleView for passing to InlineAgentCard
  const agentRoleViewMap = useMemo(
    () => new Map(agentRoleViews.map((a) => [a.role.toLowerCase(), a])),
    [agentRoleViews]
  );

  // Build a status lookup map
  const statusMap = useMemo(() => {
    const map = new Map<string, (typeof agentStatusList)[number]>();
    for (const agent of agentStatusList) {
      map.set(agent.role.toLowerCase(), agent);
    }
    return map;
  }, [agentStatusList]);

  // Batch restart summaries for all roles
  const allRoles = useMemo(() => agentStatusList.map((a) => a.role), [agentStatusList]);
  const restartSummaries = useSessionQuery(api.machines.getAgentRestartSummariesByRoles, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    roles: allRoles,
  });
  const restartSummaryMap = useMemo(() => {
    const map = new Map<string, { count1h: number; count24h: number }>();
    if (restartSummaries) {
      for (const summary of restartSummaries) {
        map.set(summary.role.toLowerCase(), {
          count1h: summary.count1h,
          count24h: summary.count24h,
        });
      }
    }
    return map;
  }, [restartSummaries]);

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>All Agents ({agents.length})</FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody className="flex flex-col p-0 overflow-hidden">
          {/* Agent list — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {agents.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-xs text-chatroom-text-muted uppercase tracking-wide">
                  No agents configured
                </p>
              </div>
            ) : (
              agents.map((agent) => {
                const status = statusMap.get(agent.role.toLowerCase());

                return (
                  <InlineAgentCard
                    key={agent.role}
                    role={agent.role}
                    allRoles={teamRoles}
                    online={status?.online ?? false}
                    lastSeenAt={status?.lastSeenAt}
                    latestEventType={status?.latestEventType}
                    statusVariant={status?.statusVariant ?? 'offline'}
                    prompt={generatePrompt(agent.role)}
                    chatroomId={chatroomId}
                    connectedMachines={connectedMachines}
                    isLoadingMachines={isPanelLoading}
                    agentConfigs={agentConfigs}
                    sendCommand={sendCommand}
                    agentRoleView={agentRoleViewMap.get(agent.role.toLowerCase())}
                    agentPreference={agentPreferenceMap.get(agent.role.toLowerCase())}
                    onSavePreference={savePreference}
                    restartSummary={restartSummaryMap.get(agent.role.toLowerCase())}
                  />
                );
              })
            )}
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
