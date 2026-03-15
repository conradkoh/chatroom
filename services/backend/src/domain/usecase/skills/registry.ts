/**
 * Skill Module Registry
 *
 * Defines the SkillModule interface and the SKILLS_REGISTRY constant.
 * To add a new skill: create a module in ./modules/<skill-id>/index.ts
 * and add it to SKILLS_REGISTRY below. No Convex changes needed.
 */

import { backlogSkill } from './modules/backlog/index';
import { softwareEngineeringSkill } from './modules/software-engineering/index';

export interface SkillModule {
  skillId: string;
  name: string;
  description: string;
  getPrompt(cliEnvPrefix: string): string;
}

export const SKILLS_REGISTRY: readonly SkillModule[] = [backlogSkill, softwareEngineeringSkill];
