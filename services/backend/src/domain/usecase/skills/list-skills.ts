/**
 * list-skills use case
 *
 * Pure function — reads from SKILLS_REGISTRY. No DB access.
 * Returns a summary view of all available skills.
 */

import { SKILLS_REGISTRY } from './registry';

export interface SkillSummary {
  skillId: string;
  name: string;
  description: string;
  type: 'builtin';
}

export function listSkills(): SkillSummary[] {
  return SKILLS_REGISTRY.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    description: s.description,
    type: 'builtin' as const,
  }));
}
