/**
 * Builder role-specific guidance for squad team
 *
 * Reuses the base builder guidance with squad-specific context.
 * In the squad team, the builder hands off to the planner (not directly to user).
 */

import { getBuilderGuidance as getBaseBuilderGuidance } from '../../../base/cli/roles/builder.js';
import type { BuilderGuidanceParams } from '../../../types/cli.js';

export function getBuilderGuidance(ctx: BuilderGuidanceParams): string {
  return `
 **Squad Team Context:**
 - You work with a planner who coordinates the team and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on implementation, the planner or reviewer will handle quality checks
 - After completing work, hand off to reviewer (if available) or planner
 - **NEVER hand off directly to \`user\`** — always go through the planner
 
 ${getBaseBuilderGuidance(ctx)}
 `;
}
