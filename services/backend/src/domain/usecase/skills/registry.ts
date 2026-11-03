/**
 * Skill Module Registry
 *
 * Defines the SkillModule interface and the SKILLS_REGISTRY constant.
 * To add a new skill: create a module in ./modules/<skill-id>/index.ts
 * and add it to SKILLS_REGISTRY below. No Convex changes needed.
 */

import { supportsCustomAgents } from '@workspace/shared/domain/custom-agent';

import { backlogSkill } from './modules/backlog/index';
import { codeReviewSkill } from './modules/code-review/index';
import { customAgentsSkill } from './modules/custom-agents/index';
import { dataDesignSkill } from './modules/data-design/index';
import { defragmentationSkill } from './modules/defragmentation/index';
import { gameAsset2dAiSkill } from './modules/game-asset-2d-ai/index';
import { gameAsset3dAiSkill } from './modules/game-asset-3d-ai/index';
import { gameAsset3dProceduralSkill } from './modules/game-asset-3d-procedural/index';
import { userCentricitySkill } from './modules/user-centricity/index';
import type { SkillId } from '../../types/skills';

export interface SkillModule {
  skillId: SkillId;
  name: string;
  description: string;
  getPrompt(cliEnvPrefix: string): string;
}

export const SKILLS_REGISTRY: readonly SkillModule[] = [
  backlogSkill,
  codeReviewSkill,
  defragmentationSkill,
  userCentricitySkill,
  dataDesignSkill,
  customAgentsSkill,
  gameAsset3dAiSkill,
  gameAsset2dAiSkill,
  gameAsset3dProceduralSkill,
];

/**
 * The skills a team may list. Custom agents exist only on duo teams, so the
 * `custom-agents` skill is hidden everywhere else. An absent team id keeps the
 * full list, because the caller cannot prove the team is not duo.
 */
export function skillsForTeam(teamId: string | undefined): readonly SkillModule[] {
  if (teamId === undefined) return SKILLS_REGISTRY;
  return SKILLS_REGISTRY.filter(
    (skill) => skill.skillId !== 'custom-agents' || supportsCustomAgents(teamId)
  );
}
