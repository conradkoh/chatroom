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

\`\`\`
@startuml
start
:Receive task from user;
:Decompose into phases;
repeat
  :Delegate ONE phase to **builder**;
  :Builder completes phase;
  :Builder hands off to **reviewer**;
  :Reviewer validates;
  :Reviewer hands off to **planner**;
  if (phase acceptable?) then (no)
    :Hand back to **builder** with feedback;
  else (yes)
  endif
repeat while (more phases?) is (yes)
->no;
:Deliver final result to **user**;
stop
@enduml
\`\`\``;
}

/**
 * Planner + Builder workflow (no reviewer — planner self-reviews).
 */
export function getPlannerPlusBuilderWorkflow(): string {
  return `**Current Workflow: Planner + Builder (no reviewer)**

\`\`\`
@startuml
start
:Receive task from user;
:Decompose into phases;
repeat
  :Delegate ONE phase to **builder**;
  :Builder completes phase;
  :Builder hands off to **planner**;
  :Review work yourself (acting as reviewer);
  if (phase acceptable?) then (no)
    :Hand back to **builder** with feedback;
  else (yes)
  endif
repeat while (more phases?) is (yes)
->no;
:Deliver final result to **user**;
stop
@enduml
\`\`\``;
}

/**
 * Planner + Reviewer workflow (no builder — reviewer acts as implementer).
 */
export function getPlannerPlusReviewerWorkflow(): string {
  return `**Current Workflow: Planner + Reviewer (no builder)**

\`\`\`
@startuml
start
:Receive task from user;
:Decompose into phases;
repeat
  :Delegate ONE phase to **reviewer** (acts as builder);
  :Reviewer completes phase;
  :Reviewer hands off to **planner**;
  if (phase acceptable?) then (no)
    :Hand back to **reviewer** with feedback;
  else (yes)
  endif
repeat while (more phases?) is (yes)
->no;
:Deliver final result to **user**;
stop
@enduml
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
