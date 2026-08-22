/** Canonical, project-agnostic UX dimensions for enhancer planning input. */
export function renderWebappUxHandoffReference(): string {
  return [
    '### UX planning checklist',
    'Complete the optional **UX** section when the user request involves UI changes. Write exactly "Not Applicable." for non-UI tasks. Put code snippets in **Implementation notes** only.',
    '',
    '1. **Flows** — is the primary path straightforward? simpler alternatives exist?',
    '2. **Patterns** — consistent with existing project components and conventions? recommend one when multiple exist.',
    '3. **Layout** — unnecessary complexity or wrappers? layout stable across loading/empty/error transitions (no layout shift when async content arrives or state changes)?',
    '4. **Shortcuts** — aligned with the project keyboard/shortcut conventions? gaps or conflicts?',
    '5. **States** — loading, error, and empty states explicitly handled for async surfaces (no blank panels, silent failures, or missing retry affordances)?',
    '6. **Error boundaries** — failures scoped so one subtree does not crash the whole app?',
    '7. **Feedback** — timely response for async user actions?',
    "8. **Interaction affordance** — clickable/interactive elements use pointer cursor (or the project's established equivalent) where applicable?",
    '9. **Destructive actions** — irreversible or high-impact single actions gated by confirmation?',
    '10. **Bulk actions** — batch/multi-item operations confirmed with scope or impact summary?',
    '',
    '### Planning principles',
    '- Ground findings in user history and the project codebase — cite existing patterns rather than inventing generic UI preferences.',
    '- Flag missing states, layout-shift risk, and missing interaction affordances when the plan omits them; recommend consistency with established project conventions.',
    '- Do **not** prescribe style choices the project has not adopted (e.g. specific flex layouts, canonical card chrome, responsive utility patterns, button label copy).',
    '- When multiple valid patterns exist in the codebase, recommend one and explain the tradeoff.',
  ].join('\n');
}
// fallow-ignore-next-line unused-export
export function renderWebappUxReference(): string {
  return renderWebappUxHandoffReference();
}
export function getUxReviewTriggerDescription(): string {
  return 'when the user request involves user interface changes';
}
