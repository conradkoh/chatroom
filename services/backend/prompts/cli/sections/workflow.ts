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
  } else if (config.hasBuilder && !config.hasReviewer) {
    return getPlannerPlusBuilderWorkflow();
  } else if (!config.hasBuilder && config.hasReviewer) {
    return getPlannerPlusReviewerWorkflow();
  } else {
    return getPlannerSoloWorkflow();
  }
}

/**
 * Full team workflow: Planner + Builder + Reviewer.
 */
export function getFullTeamWorkflow(): string {
  return `**Current Workflow: Full Team (Planner + Builder + Reviewer)**

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Receive task from user]
    B --> C[Decompose into phases]
    C --> D[Delegate ONE phase to builder]
    D --> E[Builder completes phase]
    E --> F[Builder hands off to reviewer]
    F --> G[Reviewer validates]
    G --> H[Reviewer hands off to planner]
    H --> I{phase acceptable?}
    I -->|no| J[Hand back to builder with feedback]
    J --> D
    I -->|yes| K{more phases?}
    K -->|yes| D
    K -->|no| L[Deliver final result to user]
    L --> M([Stop])
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
    B --> C[Decompose into phases]
    C --> D[Delegate ONE phase to builder]
    D --> E[Builder completes phase]
    E --> F[Builder hands off to planner]
    F --> G[Review work yourself acting as reviewer]
    G --> H{phase acceptable?}
    H -->|no| I[Hand back to builder with feedback]
    I --> D
    H -->|yes| J{more phases?}
    J -->|yes| D
    J -->|no| K[Deliver final result to user]
    K --> L([Stop])
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
    B --> C[Decompose into phases]
    C --> D[Delegate ONE phase to reviewer acts as builder]
    D --> E[Reviewer completes phase]
    E --> F[Reviewer hands off to planner]
    F --> G{phase acceptable?}
    G -->|no| H[Hand back to reviewer with feedback]
    H --> D
    G -->|yes| I{more phases?}
    I -->|yes| D
    I -->|no| J[Deliver final result to user]
    J --> K([Stop])
\`\`\``;
}

/**
 * Planner solo workflow (no other team members).
 */
export function getPlannerSoloWorkflow(): string {
  return `**Current Workflow: Planner Solo**

1. Receive task from user
2. Implement the solution yourself
3. Review your own work for quality
4. Deliver to **user**`;
}
