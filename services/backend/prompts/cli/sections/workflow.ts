/**
 * Workflow diagram section builders for the planner role.
 *
 * Each function returns the appropriate workflow diagram string for a
 * given team composition. Team-specific prompt files select the correct
 * one directly (no runtime branching at the call site when team
 * composition is known at compile time).
 */

import type { TeamCompositionConfig } from './team-composition';

/**
 * Select and return the correct workflow diagram for the given team config.
 *
 * Used by `getPlannerGuidance` in the base role module where team
 * composition is derived at runtime from `availableMembers`.
 */
export function getWorkflowSection(config: TeamCompositionConfig): string {
  if (config.hasBuilder && config.hasReviewer) {
    return getFullTeamWorkflow();
  }
  if (config.hasBuilder && !config.hasReviewer) {
    return getPlannerPlusBuilderWorkflow();
  }
  if (!config.hasBuilder && config.hasReviewer) {
    return getPlannerPlusReviewerWorkflow();
  }
  return getPlannerSoloWorkflow();
}

/**
 * Full team workflow: Planner + Builder + Reviewer.
 */
export function getFullTeamWorkflow(): string {
  return `**Current Workflow: Full Team (Planner + Builder + Reviewer)**

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Receive task from user]
    B --> C[task read:\nget content + mark in_progress]
    C --> D[Classify with classify]
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
    O --> P([Stop])
\`\`\``;
}

/**
 * Planner + Builder workflow (no reviewer — planner self-reviews).
 */
export function getPlannerPlusBuilderWorkflow(): string {
  return `**Current Workflow: Planner + Builder (no reviewer)**

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Receive task from user]
    B --> C[task read:\nget content + mark in_progress]
    C --> D[Classify with classify]
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
    N --> O([Stop])
\`\`\``;
}

/**
 * Planner + Reviewer workflow (no builder — reviewer acts as implementer).
 */
export function getPlannerPlusReviewerWorkflow(): string {
  return `**Current Workflow: Planner + Reviewer (no builder)**

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Receive task from user]
    B --> C[task read:\nget content + mark in_progress]
    C --> D[Classify with classify]
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
    M --> N([Stop])
\`\`\``;
}

/**
 * Planner solo workflow (no other team members).
 */
export function getPlannerSoloWorkflow(): string {
  return `**Current Workflow: Planner Solo**

1. Receive task from user
2. Run task read (get content + mark in_progress)
3. Classify with classify
4. Implement the solution yourself
5. Review your own work for quality
6. Verify: \`pnpm typecheck && pnpm test\`
7. Deliver to **user**`;
}
