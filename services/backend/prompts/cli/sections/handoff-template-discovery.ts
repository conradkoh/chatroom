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

// fallow-ignore-next-line complexity
export function getHandoffTemplateDiscoveryGuidance(
  params: HandoffTemplateDiscoveryGuidanceParams = {}
): string {
  const teamId = params.teamId ?? 'duo';
  const role = params.rolePlaceholder ?? 'planner';
  const normalizedRole = role.trim().toLowerCase();
  const designRoleInspectionGuidance =
    normalizedRole === 'architect' || normalizedRole === 'uiux-engineer'
      ? `

For a static, no-network inspection of an architect or UI/UX engineer generic outbound prompt, omit the target role:
\`\`\`bash
chatroom handoff view-template --role="architect"
chatroom handoff view-template --role="uiux-engineer"
\`\`\`
These role-only commands print the generic architect or UI/UX engineer handback template with an \`<entry-point-role>\` placeholder; replace it before running the handoff command.`
      : '';

  return `**Role-owned handoff contracts:** Before work that may require a handoff, inspect your role's contract and renderable templates:
\`\`\`bash
chatroom handoff list-templates --role="${role}" --team-id="${teamId}"
\`\`\`
This lists who you receive work from, who you return to, and every outbound handoff template you can use.${designRoleInspectionGuidance}`;
}
