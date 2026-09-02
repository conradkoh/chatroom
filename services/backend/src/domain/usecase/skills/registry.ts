/**
 * Skill Module Registry
 *
 * Defines the SkillModule interface and the SKILLS_REGISTRY constant.
 * To add a new skill: create a module in ./modules/<skill-id>/index.ts
 * and add it to SKILLS_REGISTRY below. No Convex changes needed.
 */

import { backlogSkill } from './modules/backlog/index';
import { codeReviewSkill } from './modules/code-review/index';
import { dataDesignSkill } from './modules/data-design/index';
import { defragmentationSkill } from './modules/defragmentation/index';
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
];
