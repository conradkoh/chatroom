/**
 * Common handoff template discovery guidance.
 *
 * Tells an agent to inspect its role-owned handoff contract and renderable
 * outbound templates before work that may require a handoff. Static: no
 * chatroom id and no network calls.
 */

export interface HandoffTemplateDiscoveryGuidanceParams {
  teamId?: string | undefined;
  rolePlaceholder?: string | undefined;
}

export function getHandoffTemplateDiscoveryGuidance(
  params: HandoffTemplateDiscoveryGuidanceParams = {}
): string {
  const teamId = params.teamId ?? 'duo';
  const role = params.rolePlaceholder ?? 'planner';

  return `**Role-owned handoff contracts:** Before work that may require a handoff, inspect your role's contract and renderable templates:
\`\`\`bash
chatroom handoff list-templates --role="${role}" --team-id="${teamId}"
\`\`\`
This lists who you receive work from, who you return to, and every outbound handoff template you can use.`;
}
