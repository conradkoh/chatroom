/**
 * Squad team workflow logic
 *
 * Provides workflow guidance that adapts based on which team members
 * are currently available. The planner is always present and acts as
 * the coordinator.
 */

/**
 * Get squad team workflow guidance
 */
export function getSquadWorkflow(ctx: {
  role: string;
  teamRoles: string[];
  availableMembers?: string[];
}): string {
  const available = ctx.availableMembers ?? ctx.teamRoles;
  const hasBuilder = available.some((r) => r.toLowerCase() === 'builder');
  const hasReviewer = available.some((r) => r.toLowerCase() === 'reviewer');

  let workflowVariant: string;
  if (hasBuilder && hasReviewer) {
    workflowVariant = 'Full Team';
  } else if (hasBuilder) {
    workflowVariant = 'Planner + Builder';
  } else if (hasReviewer) {
    workflowVariant = 'Planner + Reviewer';
  } else {
    workflowVariant = 'Planner Solo';
  }

  return `
## Squad Team Workflow

**Current Role:** ${ctx.role}
**Team Members:** ${ctx.teamRoles.join(', ')}
**Active Members:** ${available.join(', ')}
**Workflow Variant:** ${workflowVariant}

**Routing Rules:**
- Only the **planner** communicates with the user
- Builder and reviewer hand off to **planner** (never directly to user)
- Planner delegates to available team members

**Handoff Flow (${workflowVariant}):**
${getWorkflowDiagram(hasBuilder, hasReviewer)}

**Quality Standards:**
- All code changes must be reviewed before user delivery
- If reviewer is unavailable, planner performs the review
- Follow established coding standards
- Include appropriate error handling
- Document complex logic

**Communication Style:**
- Planner provides clear, actionable instructions to team members
- Team members provide detailed summaries in handoffs
- Be specific and constructive in feedback
- Maintain professional tone`;
}

function getWorkflowDiagram(hasBuilder: boolean, hasReviewer: boolean): string {
  if (hasBuilder && hasReviewer) {
    return `- User → Planner → Builder → Reviewer → Planner → User`;
  }
  if (hasBuilder) {
    return `- User → Planner → Builder → Planner(reviews) → User`;
  }
  if (hasReviewer) {
    return `- User → Planner → Reviewer(implements) → Planner → User`;
  }
  return `- User → Planner(implements + reviews) → User`;
}
