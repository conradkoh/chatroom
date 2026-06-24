/**
 * Operating-model diagram section builders for the planner role.
 */

import type { TeamCompositionConfig } from './team-composition';
import { getOperatingModelLoopFooter } from '../../native/session-continuity';

/** Mermaid nodes from task receipt through classify (native skips task read). */
function getTaskIntakeThroughClassifyNodes(nativeIntegration?: boolean): string {
  if (nativeIntegration) {
    return `    A([Start]) --> B[Receive user message]
    B --> D[Classify with classify]`;
  }
  return `    A([Start]) --> B[Receive chatroom task from user]
    B --> C[task read:
 get content + mark in_progress]
    C --> D[Classify with classify]`;
}

/**
 * Select and return the correct operating-model diagram for the given team config.
 */
export function getOperatingModelSection(
  config: TeamCompositionConfig,
  nativeIntegration?: boolean
): string {
  if (config.hasBuilder) {
    return getPlannerPlusBuilderOperatingModel(nativeIntegration);
  }
  return getPlannerSoloOperatingModel(nativeIntegration);
}

/**
 * Planner + Builder operating model (planner reviews builder output before delivery).
 */
export function getPlannerPlusBuilderOperatingModel(nativeIntegration?: boolean): string {
  const footer = getOperatingModelLoopFooter(nativeIntegration);
  return `**Operating model: Planner + Builder**

Other agents may be offline when you delegate — hand off and wait for work to return, or implement yourself if blocked.

\`\`\`mermaid
flowchart TD
${getTaskIntakeThroughClassifyNodes(nativeIntegration)}
    D --> E[Decompose into phases]
    E --> F[Delegate ONE phase to builder]
    F --> G[Builder completes phase]
    G --> H[Builder hands off to planner]
    H --> I[Review work yourself]
    I --> J{phase acceptable?}
    J -->|no| K[Hand back to builder with feedback]
    K --> F
    J -->|yes| L{more phases?}
    L -->|yes| F
    L -->|no| M[Verify: pnpm typecheck && pnpm test]
    M --> N[Deliver final result to user]
    N --> O[${footer}] --> B
\`\`\``;
}

/**
 * Planner solo operating model (no other team members).
 */
export function getPlannerSoloOperatingModel(nativeIntegration?: boolean): string {
  const continueStep = nativeIntegration
    ? 'Hand off when complete'
    : 'Run `get-next-task` to continue the session (Level A continues after Level B completes)';
  const intakeSteps = nativeIntegration
    ? `1. Receive user message
2. Classify with classify`
    : `1. Receive chatroom task from user
2. Run task read (get chatroom task content + mark in_progress)
3. Classify with classify`;
  const planStepNum = nativeIntegration ? 3 : 4;
  return `**Operating model: Planner Solo**

${intakeSteps}
${planStepNum}. **Plan**: Outline the approach mentally or in scratch notes. Questions and simple tasks need no plan.
${planStepNum + 1}. Implement the solution yourself
${planStepNum + 2}. Review your own work for quality
${planStepNum + 3}. Verify: \`pnpm typecheck && pnpm test\`
${planStepNum + 4}. Deliver to **user**
${planStepNum + 5}. ${continueStep}`;
}
