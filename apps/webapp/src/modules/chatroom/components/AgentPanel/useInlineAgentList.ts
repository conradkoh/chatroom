import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useContext, useMemo } from 'react';

import { useAgentPanelData } from '../../hooks/useAgentPanelData';
import { useAgentStatuses } from '../../hooks/useAgentStatuses';

import { PromptsContext } from '@/contexts/PromptsContext';

export function useInlineAgentList(chatroomId: string) {
  const {
    agents: agentRoleViews,
    teamRoles,
    connectedMachines,
    machineConfigs: agentConfigs,
    isLoading: isPanelLoading,
    sendCommand,
    teamId,
    statusReadModel,
  } = useAgentPanelData(chatroomId, { loadConfigs: true });
  const { agents: agentStatusList } = useAgentStatuses(
    teamRoles,
    statusReadModel
  );
  const promptsContext = useContext(PromptsContext);
  const generatePrompt = useCallback(
    (role: string): string => promptsContext?.getAgentPrompt(role) ?? '',
    [promptsContext]
  );
  const agentRoleViewMap = useMemo(
    () => new Map(agentRoleViews.map((agent) => [agent.role.toLowerCase(), agent])),
    [agentRoleViews]
  );
  const statusMap = useMemo(() => {
    const map = new Map<string, (typeof agentStatusList)[number]>();
    for (const agent of agentStatusList) map.set(agent.role.toLowerCase(), agent);
    return map;
  }, [agentStatusList]);
  const allRoles = useMemo(() => agentStatusList.map((agent) => agent.role), [agentStatusList]);
  const restartSummaries = useSessionQuery(api.machines.getAgentRestartSummariesByRoles, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    roles: allRoles,
  });
  const restartSummaryMap = useMemo(() => {
    const map = new Map<string, { count3h: number; count3d: number }>();
    if (restartSummaries) {
      for (const summary of restartSummaries) {
        map.set(summary.role.toLowerCase(), { count3h: summary.count3h, count3d: summary.count3d });
      }
    }
    return map;
  }, [restartSummaries]);
  return {
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
    onlineCount: agentStatusList.filter((agent) => agent.online).length,
    totalCount: agentStatusList.length,
  };
}
