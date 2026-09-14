'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { memo, useCallback, useContext, useMemo } from 'react';

import { AgentControlDataProvider } from './AgentControlDataContext';
import { InlineAgentCard } from './InlineAgentCard';
import {
  useWorkspaceAgentControlData,
  useWorkspaceAgentDirectory,
  type WorkspaceAgentRole,
} from '../../hooks/useWorkspaceAgentQueries';

import { PromptsContext } from '@/contexts/PromptsContext';

interface WorkspaceInlineAgentListPanelProps {
  chatroomId: string;
  variant?: 'plain' | 'bordered';
  emptyClassName?: string;
}

export const WorkspaceInlineAgentListPanel = memo(function WorkspaceInlineAgentListPanel({
  chatroomId,
  variant = 'plain',
  emptyClassName,
}: WorkspaceInlineAgentListPanelProps) {
  const { workspace, agents, isLoading: isLoadingDirectory } = useWorkspaceAgentDirectory();
  const promptsContext = useContext(PromptsContext);
  const generatePrompt = useCallback(
    (role: string) => promptsContext?.getAgentPrompt(role) ?? '',
    [promptsContext]
  );
  const roles = useMemo(() => agents.map((agent) => agent.role), [agents]);
  const restartSummaries = useSessionQuery(api.machines.getAgentRestartSummariesByRoles, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    roles,
  });
  const restartSummaryMap = useMemo(() => {
    const map = new Map<string, { count3h: number; count3d: number }>();
    for (const summary of restartSummaries ?? []) {
      map.set(summary.role.toLowerCase(), {
        count3h: summary.count3h,
        count3d: summary.count3d,
      });
    }
    return map;
  }, [restartSummaries]);

  if (isLoadingDirectory) {
    return (
      <div
        className={
          emptyClassName ??
          'flex items-center justify-center p-8 text-xs text-chatroom-text-muted uppercase tracking-wide'
        }
      >
        Loading agents...
      </div>
    );
  }

  if (!workspace || !workspace._registryId) {
    return (
      <div
        className={
          emptyClassName ??
          'flex items-center justify-center p-8 text-xs text-chatroom-text-muted uppercase tracking-wide'
        }
      >
        No active workspace
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div
        className={
          emptyClassName ??
          'flex items-center justify-center p-8 text-xs text-chatroom-text-muted uppercase tracking-wide'
        }
      >
        No agents in team structure
      </div>
    );
  }

  const list = (
    <WorkspaceInlineAgentCards
      chatroomId={chatroomId}
      workspaceId={workspace._registryId}
      agents={agents}
      roles={roles}
      generatePrompt={generatePrompt}
      restartSummaryMap={restartSummaryMap}
    />
  );

  return variant === 'bordered' ? (
    <div className="border border-chatroom-border bg-chatroom-bg-surface">{list}</div>
  ) : (
    <>{list}</>
  );
});

const WorkspaceInlineAgentCards = memo(function WorkspaceInlineAgentCards({
  chatroomId,
  workspaceId,
  agents,
  roles,
  generatePrompt,
  restartSummaryMap,
}: {
  chatroomId: string;
  workspaceId: string;
  agents: WorkspaceAgentRole[];
  roles: string[];
  generatePrompt: (role: string) => string;
  restartSummaryMap: Map<string, { count3h: number; count3d: number }>;
}) {
  const controlData = useWorkspaceAgentControlData();
  const permanentAgents = agents.filter(
    (agent) => agent.lifecycle !== AgentRoleLifecycleTag.Ephemeral
  );
  const ephemeralAgents = agents.filter(
    (agent) => agent.lifecycle === AgentRoleLifecycleTag.Ephemeral
  );

  const renderCards = (group: WorkspaceAgentRole[]) =>
    group.map((agent) => (
      <InlineAgentCard
        key={`${workspaceId}-${agent.role}`}
        role={agent.role}
        lifecycle={agent.lifecycle}
        allRoles={roles}
        prompt={generatePrompt(agent.role)}
        chatroomId={chatroomId}
        workspaceId={workspaceId}
        restartSummary={restartSummaryMap.get(agent.role.toLowerCase())}
        teamId={agent.teamId ?? undefined}
      />
    ));

  return (
    <AgentControlDataProvider value={controlData}>
      {renderCards(permanentAgents)}
      {ephemeralAgents.length > 0 && (
        <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted border-t border-chatroom-border">
          Ephemeral ({ephemeralAgents.length})
        </div>
      )}
      {renderCards(ephemeralAgents)}
    </AgentControlDataProvider>
  );
});
