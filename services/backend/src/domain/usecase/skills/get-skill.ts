/**
 * get-skill use case
 *
 * Pure function — looks up a skill by ID among the skills the chatroom's team may
 * use. Returns the full skill shape (including prompt) or null.
 *
 * Team gating lives in `skillsForTeam`, the same filter `list` applies: a skill
 * the team cannot list is unknown to `get` and `activate`.
 */

import { skillsForTeam } from './registry';

export interface SkillDetail {
  skillId: string;
  name: string;
  description: string;
  type: 'builtin';
  isEnabled: true;
  prompt: string;
}

export function getSkill(
  skillId: string,
  cliEnvPrefix: string,
  teamId: string | undefined
): SkillDetail | null {
  const skill = skillsForTeam(teamId).find((s) => s.skillId === skillId);
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
