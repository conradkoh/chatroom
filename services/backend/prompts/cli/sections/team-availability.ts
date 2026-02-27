/**
 * Team availability section for the planner role.
 *
 * Shows a dynamic summary of which non-planner team members are
 * currently available to receive work.
 */

/**
 * Generate the Team Availability section.
 *
 * @param availableMembers - The currently online team members (including planner)
 */
export function getTeamAvailabilitySection(availableMembers: string[]): string {
  const nonPlannerMembers = availableMembers.filter((r) => r.toLowerCase() !== 'planner');

  if (nonPlannerMembers.length === 0) {
    return `**Team Availability:** You are working solo. Handle implementation and review yourself.`;
  }

  return `**Team Availability:** ${nonPlannerMembers.join(', ')} available.`;
}
