/**
 * Team availability section for the planner role.
 *
 * Shows a summary of which non-planner team members are
 * configured for the team.
 */

/**
 * Generate the Team Availability section.
 *
 * @param teamMembers - The team members (from teamRoles configuration)
 */
export function getTeamAvailabilitySection(teamMembers: string[]): string {
  const nonPlannerMembers = teamMembers.filter((r) => r.toLowerCase() !== 'planner');

  if (nonPlannerMembers.length === 0) {
    return `**Team Availability:** You are working solo. Handle implementation and review yourself.`;
  }

  return `**Team Availability:** ${nonPlannerMembers.join(', ')} available.`;
}
