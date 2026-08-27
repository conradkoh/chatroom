'use client';

import { memo } from 'react';

import { InlineAgentCard } from './InlineAgentCard';
import { useInlineAgentList } from './useInlineAgentList';

interface InlineAgentListPanelProps {
  chatroomId: string;
  /** Settings tab wraps list in bordered surface; modal uses plain scroll body. */
  variant?: 'plain' | 'bordered';
  emptyClassName?: string;
}

function InlineAgentCardList({
  agentStatusList,
  teamRoles,
  connectedMachines,
  agentConfigs,
  isPanelLoading,
  sendCommand,
  teamId,
  generatePrompt,
  agentRoleViewMap,
  statusMap,
  restartSummaryMap,
  chatroomId,
}: Omit<ReturnType<typeof useInlineAgentList>, 'onlineCount' | 'totalCount'> & {
  chatroomId: string;
}) {
  return agentStatusList.map((agent) => {
    const status = statusMap.get(agent.role.toLowerCase());
    const {
      online = false,
      lastSeenAt,
      statusLabel = 'OFFLINE',
      statusVariant = 'offline',
    } = status ?? {};
    return (
      <InlineAgentCard
        key={`${teamId}-${agent.role}`}
        role={agent.role}
        allRoles={teamRoles}
        online={online}
        lastSeenAt={lastSeenAt}
        statusLabel={statusLabel}
        statusVariant={statusVariant}
        prompt={generatePrompt(agent.role)}
        chatroomId={chatroomId}
        connectedMachines={connectedMachines}
        isLoadingMachines={isPanelLoading}
        agentConfigs={agentConfigs}
        sendCommand={sendCommand}
        agentRoleView={agentRoleViewMap.get(agent.role.toLowerCase())}
        restartSummary={restartSummaryMap.get(agent.role.toLowerCase())}
        teamId={teamId}
      />
    );
  });
}

export const InlineAgentListPanel = memo(function InlineAgentListPanel({
  chatroomId,
  variant = 'plain',
  emptyClassName,
}: InlineAgentListPanelProps) {
  const {
    agentStatusList,
    teamRoles,
    connectedMachines,
    agentConfigs,
    isPanelLoading,
    sendCommand,
    teamId,
    generatePrompt,
    agentRoleViewMap,
    statusMap,
    restartSummaryMap,
  } = useInlineAgentList(chatroomId);

  if (agentStatusList.length === 0) {
    return (
      <div
        className={
          emptyClassName ??
          'flex items-center justify-center p-8 text-xs text-chatroom-text-muted uppercase tracking-wide'
        }
      >
        No agents configured
      </div>
    );
  }

  const list = (
    <InlineAgentCardList
      {...{
        agentStatusList,
        teamRoles,
        connectedMachines,
        agentConfigs,
        isPanelLoading,
        sendCommand,
        teamId,
        generatePrompt,
        agentRoleViewMap,
        statusMap,
        restartSummaryMap,
        chatroomId,
      }}
    />
  );

  return variant === 'bordered' ? (
    <div className="border border-chatroom-border bg-chatroom-bg-surface">{list}</div>
  ) : (
    <>{list}</>
  );
});
