/**
 * Essential UX dimensions embedded in enhancer frontend flow design.
 * Migrated from webapp-ux-reference.ts — checklist lives per-flow, not a separate section.
 */

/** Planning principles shown once at the top of handoff-frontend-design. */
export function getFrontendDesignUxPlanningPrinciplesBlock(): string {
  return `<!-- Ground every flow in user history and repository patterns. Recommend one existing pattern when multiple exist; do not prescribe style choices the project has not adopted. -->`;
}

/**
 * Per-flow UX quality checklist — complete for every interactive step in the flow.
 * Covers the essential dimensions from the former UX planning checklist.
 */
export function getFrontendDesignUxFlowChecklistBlock(): string {
  return `**UX quality (complete for every interactive step in this flow):**
- **States:** loading | empty | error | success — no blank panels, silent failures, or missing retry affordances
- **Layout:** stable across async transitions — no layout shift when content arrives or state changes
- **Patterns:** consistent with existing project components — cite the chosen pattern and repo-relative file
- **Shortcuts:** aligned with project keyboard/shortcut conventions; document tab order and gaps
- **Feedback:** timely response for async user actions
- **Interaction affordance:** pointer cursor (or project equivalent) on clickable elements
- **Safeguards:** confirmation before destructive actions; bulk operations confirmed with scope summary`;
}

export function getFrontendDesignUxTriggerDescription(): string {
  return 'when the user request involves user interface changes';
}
