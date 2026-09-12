'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { MachineConnectivity } from '../../../../hooks/useDaemonConnectivity';
import type { AgentConfig, MachineInfo, SendCommandFn } from '../../types/machine';

export interface AgentControlData {
  machines: MachineInfo[];
  daemonConnectivity: Map<string, MachineConnectivity>;
  agentConfigs: AgentConfig[];
  isLoadingMachines: boolean;
  sendCommand: SendCommandFn;
}

const AgentControlDataContext = createContext<AgentControlData | null>(null);

export function AgentControlDataProvider({
  value,
  children,
}: {
  value: AgentControlData;
  children: ReactNode;
}) {
  return (
    <AgentControlDataContext.Provider value={value}>{children}</AgentControlDataContext.Provider>
  );
}

export function useAgentControlData(): AgentControlData {
  const value = useContext(AgentControlDataContext);
  if (!value) {
    throw new Error('useAgentControlData must be used within AgentControlDataProvider');
  }
  return value;
}
