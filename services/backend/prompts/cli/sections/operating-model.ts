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
    : 'After delegating to the builder, hand off and wait for work to return.';
  return `**Operating model: Planner + Builder**

${delegationNote}

\`\`\`mermaid
flowchart TD
${getTaskIntakeNodes(nativeIntegration)}
    E --> F[Delegate ONE phase to builder]
    F --> G[Builder completes phase]
    G --> H[Builder hands off to planner]
    H --> I[Review builder output]
    I --> J{phase acceptable?}
    J -->|no| K[Hand back to builder with feedback]
    K --> F
    J -->|yes| L{more phases?}
    L -->|yes| F
    L -->|no| O[Deliver final result to user]
    O --> P[${footer}] --> B
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

  if (nativeIntegration) {
    return `**Operating model: Planner Solo**

${intakeSteps}
3. Deliver to **user**
4. ${continueStep}`;
  }

  return `**Operating model: Planner Solo**

${intakeSteps}
3. Review your own work for quality
4. Deliver to **user**
5. ${continueStep}`;
}
