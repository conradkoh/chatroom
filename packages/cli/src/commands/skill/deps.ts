/**
 * Skill Deps — dependency interfaces for the skill commands.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface SkillDeps {
  backend: BackendOps;
  session: SessionOps;
}
