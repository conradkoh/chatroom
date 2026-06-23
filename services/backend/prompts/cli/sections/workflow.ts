/**
 * Workflow diagram section builders for the planner role.
 *
 * Each function returns the appropriate workflow diagram string for a
 * given team composition. Team-specific prompt files select the correct
 * one directly (no runtime branching at the call site when team
 * composition is known at compile time).
 */

import type { TeamCompositionConfig } from './team-composition';
import { getWorkflowLoopFooter } from '../../native/session-continuity';

/** Mermaid nodes from task receipt through classify (native skips task read). */
function getTaskIntakeThroughClassifyNodes(nativeIntegration?: boolean): string {
  if (nativeIntegration) {
    return `    A([Start]) --> B[Receive injected chatroom task]
    B --> D[Classify with classify]`;
  }
  return `    A([Start]) --> B[Receive chatroom task from user]
    B --> C[task read:
 get content + mark in_progress]
    C --> D[Classify with classify]`;
}

/**
 * Select and return the correct workflow diagram for the given team config.
 *
 * Used by `getPlannerGuidance` in the base role module where team
 * composition is derived at runtime from `teamRoles`.
 */
export function getWorkflowSection(
  config: TeamCompositionConfig,
  nativeIntegration?: boolean
): string {
  if (config.hasBuilder && config.hasReviewer) {
    return getFullTeamWorkflow(nativeIntegration);
  }
  if (config.hasBuilder && !config.hasReviewer) {
    return getPlannerPlusBuilderWorkflow(nativeIntegration);
  }
  if (!config.hasBuilder && config.hasReviewer) {
    return getPlannerPlusReviewerWorkflow(nativeIntegration);
  }
  return getPlannerSoloWorkflow(nativeIntegration);
}

/**
 * Full team workflow: Planner + Builder + Reviewer.
 */
export function getFullTeamWorkflow(nativeIntegration?: boolean): string {
  const footer = getWorkflowLoopFooter(nativeIntegration);
  return `**Current Workflow: Full Team (Planner + Builder + Reviewer)**

\`\`\`mermaid
flowchart TD
${getTaskIntakeThroughClassifyNodes(nativeIntegration)}
    D --> E[Decompose into phases]
    E --> F[Delegate ONE phase to builder]
    F --> G[Builder completes phase]
    G --> H[Builder hands off to reviewer]
    H --> I[Reviewer validates]
    I --> J[Reviewer hands off to planner]
    J --> K{phase acceptable?}
    K -->|no| L[Hand back to builder with feedback]
    L --> F
    K -->|yes| M{more phases?}
    M -->|yes| F
    M -->|no| N[Verify: pnpm typecheck && pnpm test]
    N --> O[Deliver final result to user]
    O --> P[${footer}] --> B
\`\`\``;
}

/**
 * Planner + Builder workflow (no reviewer — planner self-reviews).
 */
export function getPlannerPlusBuilderWorkflow(nativeIntegration?: boolean): string {
  const footer = getWorkflowLoopFooter(nativeIntegration);
  return `**Current Workflow: Planner + Builder (no reviewer)**

\`\`\`mermaid
flowchart TD
${getTaskIntakeThroughClassifyNodes(nativeIntegration)}
    D --> E[Decompose into phases]
    E --> F[Delegate ONE phase to builder]
    F --> G[Builder completes phase]
    G --> H[Builder hands off to planner]
    H --> I[Review work yourself acting as reviewer]
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
 * Planner + Reviewer workflow (no builder — reviewer acts as implementer).
 */
export function getPlannerPlusReviewerWorkflow(nativeIntegration?: boolean): string {
  const footer = getWorkflowLoopFooter(nativeIntegration);
  return `**Current Workflow: Planner + Reviewer (no builder)**

\`\`\`mermaid
flowchart TD
${getTaskIntakeThroughClassifyNodes(nativeIntegration)}
    D --> E[Decompose into phases]
    E --> F[Delegate ONE phase to reviewer acts as builder]
    F --> G[Reviewer completes phase]
    G --> H[Reviewer hands off to planner]
    H --> I{phase acceptable?}
    I -->|no| J[Hand back to reviewer with feedback]
    J --> F
    I -->|yes| K{more phases?}
    K -->|yes| F
    K -->|no| L[Verify: pnpm typecheck && pnpm test]
    L --> M[Deliver final result to user]
    M --> N[${footer}] --> B
\`\`\``;
}

/**
 * Planner solo workflow (no other team members).
 */
export function getPlannerSoloWorkflow(nativeIntegration?: boolean): string {
  const continueStep = nativeIntegration
    ? 'Wait for the next task to be injected to continue the session (Level A continues after Level B completes)'
    : 'Run `get-next-task` to continue the session (Level A continues after Level B completes)';
  const intakeSteps = nativeIntegration
    ? `1. Receive injected chatroom task (content inline — do not run task read)
2. Classify with classify`
    : `1. Receive chatroom task from user
2. Run task read (get chatroom task content + mark in_progress)
3. Classify with classify`;
  const planStepNum = nativeIntegration ? 3 : 4;
  return `**Current Workflow: Planner Solo**

${intakeSteps}
${planStepNum}. **Plan**: Outline the approach mentally or in scratch notes — solo has no formal workflow tooling requirement. Questions and simple tasks need no plan.
${planStepNum + 1}. Implement the solution yourself (following workflow steps if created)
${planStepNum + 2}. Review your own work for quality
${planStepNum + 3}. Verify: \`pnpm typecheck && pnpm test\`
${planStepNum + 4}. Deliver to **user**
${planStepNum + 5}. ${continueStep}`;
}
