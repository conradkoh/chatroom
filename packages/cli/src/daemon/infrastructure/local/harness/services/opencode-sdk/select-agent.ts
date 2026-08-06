import type { Agent } from '@opencode-ai/sdk';

/**
 * Selects an opencode agent from the provided list of available agents.
 *
 * Subagents are filtered out because they are designed to be invoked from a
 * parent agent, not driven directly by external callers.
 *
 * The 'build' agent is preferred because it is opencode's canonical generalist
 * base agent — chatroom roles compose on top of it. Role-specific selection is
 * intentionally out of scope; chatroom role behaviour comes from the system prompt
 * composition (see composeSystemPrompt).
 *
 * @param agents - The list of all agents returned by client.app.agents()
 * @returns The selected Agent (never a subagent)
 * @throws If no non-subagent agents are available
 */
export function selectAgent(agents: readonly Agent[]): Agent {
  const primaries = agents.filter((a) => a.mode !== 'subagent');

  if (primaries.length === 0) {
    throw new Error('No usable opencode agent available (server returned 0 non-subagent agents)');
  }

  const buildAgent = primaries.find((a) => a.name === 'build');
  return buildAgent ?? primaries[0];
}
