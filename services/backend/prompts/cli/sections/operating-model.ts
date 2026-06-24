/**
 * Operating-model diagram section builders for the planner role.
 */

import type { TeamCompositionConfig } from './team-composition';
import {
  getNativePlannerDelegationWaitNote,
  getOperatingModelLoopFooter,
} from '../../native/session-continuity';

/** Mermaid nodes from task receipt through planning. */
function getTaskIntakeNodes(nativeIntegration?: boolean): string {
  if (nativeIntegration) {
    return `    A([Start]) --> B[Receive user message]
    B --> E[Decompose into phases]`;
  }
  return `    A([Start]) --> B[Receive chatroom task from get-next-task]
    B --> E[Decompose into phases]`;
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
  const delegationNote = nativeIntegration
    ? getNativePlannerDelegationWaitNote()
    : 'Other agents may be offline when you delegate — hand off and wait for work to return, or implement yourself if blocked.';
  return `**Operating model: Planner + Builder**

${delegationNote}

\`\`\`mermaid
flowchart TD
${getTaskIntakeNodes(nativeIntegration)}
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
2. Plan and implement`
    : `1. Receive chatroom task from get-next-task
2. Plan and implement`;
  const verifyStepNum = nativeIntegration ? 3 : 4;
  return `**Operating model: Planner Solo**

${intakeSteps}
${verifyStepNum}. Review your own work for quality
${verifyStepNum + 1}. Verify: \`pnpm typecheck && pnpm test\`
${verifyStepNum + 2}. Deliver to **user**
${verifyStepNum + 3}. ${continueStep}`;
}
