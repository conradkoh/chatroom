// fallow-ignore-file circular-dependency
// The hook module re-exports this context consumer to preserve existing import paths.

'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { useAgentPanelDataSubscriptions, type AgentPanelData } from '../hooks/useAgentPanelData';

const AgentPanelDataContext = createContext<AgentPanelData | null>(null);

export function AgentPanelDataProvider({
  chatroomId,
  children,
}: {
  chatroomId: string;
  children: ReactNode;
}) {
  const data = useAgentPanelDataSubscriptions(chatroomId, { loadConfigs: true });
  return <AgentPanelDataContext.Provider value={data}>{children}</AgentPanelDataContext.Provider>;
}

/** Agent panel subscriptions — must be used within AgentPanelDataProvider. */
export function useAgentPanelData(): AgentPanelData {
  const context = useContext(AgentPanelDataContext);
  if (!context) {
    throw new Error('useAgentPanelData must be used within AgentPanelDataProvider');
  }
  return context;
}
