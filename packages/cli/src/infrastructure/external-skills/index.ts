import { discoverExternalSkills } from './discover-external-skills.js';
import type { ExternalSkillsOps } from './types.js';

export type { ExternalSkillsOps } from './types.js';
export { mergeSkillCatalog, findExternalSkill } from './merge-skill-catalog.js';
export type { BuiltinSkillSummary, SkillCatalog } from './merge-skill-catalog.js';
export type { ExternalSkill } from './types.js';

/** Live external skills ops: discovers skills under the real home directory. */
export const externalSkillsOpsLive: ExternalSkillsOps = {
  discover: () => discoverExternalSkills(),
};
