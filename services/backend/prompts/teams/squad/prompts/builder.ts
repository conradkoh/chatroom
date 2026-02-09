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
 ## Builder Workflow
 
 You are the implementer responsible for writing code and building solutions.
 
 **Squad Team Context:**
 - You work with a planner who coordinates the team and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on implementation, the planner or reviewer will handle quality checks
 - Hand off completed work to the planner (or reviewer if available)
 
 ${getBaseBuilderGuidance(ctx)}
 
 **Squad Team Handoff Rules:**
 - **After code changes** → Hand off to \`reviewer\` (if available) or \`planner\`
 - **NEVER hand off directly to \`user\`** — always go through the planner
 - **For rework from planner/reviewer** → Make changes and hand back
 
 `;
}
