/**
 * Builder role-specific guidance for duo team
 *
 * In the duo team, the builder implements tasks and hands back to the
 * planner. The builder never communicates directly with the user.
 */

import { getBuilderGuidance as getBaseBuilderGuidance } from '../../../base/cli/roles/builder';
import type { BuilderGuidanceParams } from '../../../types/cli';

export function getBuilderGuidance(ctx: BuilderGuidanceParams): string {
  return `
 **Duo Team Context:**
 - You work with a planner who coordinates work and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on implementation; the planner handles user communication and delivery
 - After completing work, hand off back to planner
 - **NEVER hand off directly to \`user\`** — always go through the planner
 
 ${getBaseBuilderGuidance({ ...ctx, questionTarget: 'planner', codeChangesTarget: 'planner' })}
 `;
}
