/**
 * Skill Module Registry
 *
 * Defines the SkillModule interface and the SKILLS_REGISTRY constant.
 * To add a new skill: create a module in ./modules/<skill-id>/index.ts
 * and add it to SKILLS_REGISTRY below. No Convex changes needed.
 */

import { backlogSkill } from './modules/backlog/index';
import { codeReviewSkill } from './modules/code-review/index';
import { developmentWorkflowSkill } from './modules/development-workflow/index';
import { softwareEngineeringSkill } from './modules/software-engineering/index';
import { workflowSkill } from './modules/workflow/index';
import type { SkillId } from '../../types/skills';

export interface SkillModule {
  skillId: SkillId;
  name: string;
  description: string;
  getPrompt(cliEnvPrefix: string): string;
}

export const SKILLS_REGISTRY: readonly SkillModule[] = [
  backlogSkill,
  softwareEngineeringSkill,
  codeReviewSkill,
  workflowSkill,
  developmentWorkflowSkill,
];
