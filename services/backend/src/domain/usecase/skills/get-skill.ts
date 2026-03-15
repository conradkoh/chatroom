/**
 * get-skill use case
 *
 * Pure function — looks up a skill by ID from SKILLS_REGISTRY.
 * Returns the full skill shape (including prompt) or null.
 */

import { SKILLS_REGISTRY } from './registry';

export interface SkillDetail {
  skillId: string;
  name: string;
  description: string;
  type: 'builtin';
  isEnabled: true;
  prompt: string;
}

export function getSkill(skillId: string, cliEnvPrefix: string): SkillDetail | null {
  const skill = SKILLS_REGISTRY.find((s) => s.skillId === skillId);
  if (!skill) return null;

  return {
    skillId: skill.skillId,
    name: skill.name,
    description: skill.description,
    type: 'builtin' as const,
    isEnabled: true,
    prompt: skill.getPrompt(cliEnvPrefix),
  };
}
