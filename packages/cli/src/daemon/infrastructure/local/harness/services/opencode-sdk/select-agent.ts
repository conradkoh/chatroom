import type { AgentInfo } from '@opencode/client';

/**
 * Selects an opencode agent from the provided list of available agents.
 *
 * Subagents and hidden maintenance agents are filtered out because they are not
 * meant to be driven directly by external callers.
 *
 * The 'build' agent is preferred because it is opencode's canonical generalist
 * base agent — chatroom roles compose on top of it. Role-specific selection is
 * intentionally out of scope; chatroom role behaviour comes from the session
 * instruction entry (see the agent service).
 *
 * @param agents - The list of agents returned by client.agent.list()
 * @returns The selected AgentInfo (never a subagent or hidden agent)
 * @throws If no usable primary agents are available
 */
export function selectAgent(agents: readonly AgentInfo[]): AgentInfo {
  const primaries = agents.filter((a) => a.mode !== 'subagent' && a.hidden !== true);

  if (primaries.length === 0) {
    throw new Error('No usable opencode agent available (server returned 0 non-subagent agents)');
  }

  const buildAgent = primaries.find((a) => a.id === 'build' || a.name === 'build');
  return buildAgent ?? primaries[0];
}
