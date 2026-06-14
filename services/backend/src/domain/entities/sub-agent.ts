/**
 * Domain Model: Sub-Agent
 *
 * Core domain types for sub-agent management. These represent the fundamental
 * concepts in the sub-agent domain — sub-agent types, role parsing, and
 * codemap path building.
 *
 * Sub-agents are spawned by parent agents to perform specialized tasks
 * (e.g., codemapper research). They operate under a separate role namespace
 * from team roles, using the format: subagent:{type}:{instanceId}.
 */

// ─── Sub-Agent Types ─────────────────────────────────────────────────────────

export const SUB_AGENT_TYPES = ['codemapper'] as const;

/** Type of a sub-agent. */
export type SubAgentType = (typeof SUB_AGENT_TYPES)[number];

// ─── Sub-Agent Role Helpers ──────────────────────────────────────────────────

/**
 * Build a sub-agent role string from type and instance ID.
 * Format: subagent:{type}:{instanceId}
 */
export function buildSubAgentRole(type: SubAgentType, instanceId: string): string {
  return `subagent:${type}:${instanceId}`;
}

/**
 * Parse a sub-agent role string back into its components.
 * Returns null if the role doesn't match the sub-agent format.
 */
export function parseSubAgentRole(role: string): { type: SubAgentType; instanceId: string } | null {
  const match = /^subagent:([^:]+):(.+)$/i.exec(role);
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (!(SUB_AGENT_TYPES as readonly string[]).includes(type)) return null;
  return { type: type as SubAgentType, instanceId: match[2] };
}

/** Check if a role string is a sub-agent role. */
export function isSubAgentRole(role: string): boolean {
  return parseSubAgentRole(role) !== null;
}

// ─── Codemap Path Helpers ────────────────────────────────────────────────────

/**
 * Build a codemap output path relative to workingDir.
 * Format: .chatroom/codemaps/{datePrefix}-{slug}.md
 */
export function buildCodemapPath(datePrefix: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `.chatroom/codemaps/${datePrefix}-${slug}.md`;
}
