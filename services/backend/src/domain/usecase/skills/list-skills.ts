/**
 * list-skills use case
 *
 * Pure function — reads from SKILLS_REGISTRY. No DB access.
 * Returns a summary view of all available skills.
 */

import { skillsForTeam } from './registry';

export interface SkillSummary {
  skillId: string;
  name: string;
  description: string;
  type: 'builtin';
}

export function listSkills(teamId?: string | undefined): SkillSummary[] {
  return skillsForTeam(teamId).map((s) => ({
    skillId: s.skillId,
    name: s.name,
    description: s.description,
    type: 'builtin' as const,
  }));
}
