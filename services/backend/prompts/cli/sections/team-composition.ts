/**
 * Team composition configuration and planner-facing composition section.
 *
 * Section builders accept `TeamCompositionConfig` so they contain no
 * runtime derivation logic — the caller (team prompt files) decides
 * the composition.
 *
 * `getTeamCompositionSection` describes configured roles — not who is
 * online. Agents can go offline; the system prompt must not imply live presence.
 */

export interface TeamCompositionConfig {
  hasBuilder: boolean;
}

/**
 * Generate the team composition section for planner prompts.
 *
 * @param teamMembers - Configured team roles (from chatroom teamRoles)
 */
export function getTeamCompositionSection(teamMembers: string[]): string {
  const isSoloRole = teamMembers.length === 1 && teamMembers[0]?.toLowerCase() === 'solo';
  const nonPlannerMembers = teamMembers.filter((r) => r.toLowerCase() !== 'planner');

  if (isSoloRole || nonPlannerMembers.length === 0) {
    return `**Team composition:** Solo team — you handle planning and implementation yourself.`;
  }

  const roleList = nonPlannerMembers.map((r) => `\`${r}\``).join(', ');

  return `**Team composition:** Duo team — you coordinate with ${roleList} for implementation.

**Agent presence:** This prompt does **not** tell you who is online. Other agents may be offline. Delegate code-changing work by handing off when appropriate; do not infer availability from team configuration or prior chat history.`;
}
