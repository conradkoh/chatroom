/**
 * Skill Deps — dependency interfaces for the skill commands.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';
import type { ExternalSkillsOps } from '../../infrastructure/external-skills/index.js';

export interface SkillDeps {
  backend: BackendOps;
  session: SessionOps;
  /** Machine-installed (external) skill discovery. Injected so tests never read the real $HOME. */
  externalSkills: ExternalSkillsOps;
}
