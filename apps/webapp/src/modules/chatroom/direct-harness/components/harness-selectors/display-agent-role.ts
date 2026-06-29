import type { AgentOption } from './types';

/** Agents the user can pick as the session driver. */
export function getEligibleAgents(agents: AgentOption[]): AgentOption[] {
  return agents.filter((a) => a.mode === 'primary' || a.mode === 'all');
}

/** True when the harness exposes more than one selectable agent role. */
function harnessHasMultipleAgentRoles(agents: AgentOption[]): boolean {
  return getEligibleAgents(agents).length > 1;
}

/**
 * Label for the agent/role selector.
 * Single-role harnesses (e.g. pi-sdk, cursor-sdk) show "default" instead of "builder".
 */
export function displayAgentRoleName(agents: AgentOption[], agentName: string): string {
  return harnessHasMultipleAgentRoles(agents) ? agentName : 'default';
}
