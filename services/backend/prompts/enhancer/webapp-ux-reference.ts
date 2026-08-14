/** Canonical, project-agnostic UX review dimensions for enhancer UI proposals. */
export function renderWebappUxHandoffReference(): string {
  return [
    '### UX review checklist',
    'Complete the optional **UX** section in your output when the planner proposes UI changes. Write exactly "Not Applicable." for non-UI tasks. Put code snippets in **Suggested edits** only.',
    '',
    '1. **Flows** — is the primary path straightforward? simpler alternatives exist?',
    '2. **Patterns** — consistent with existing project components and conventions? recommend one when multiple exist.',
    '3. **Layout** — unnecessary complexity, wrappers, or layout-shift risk?',
    '4. **Shortcuts** — aligned with the project keyboard/shortcut conventions? gaps or conflicts?',
    '5. **States** — loading, error, and empty states covered for async surfaces?',
    '6. **Error boundaries** — failures scoped so one subtree does not crash the whole app?',
    '7. **Feedback** — timely response for async user actions?',
    '8. **Destructive actions** — irreversible or high-impact single actions gated by confirmation?',
    '9. **Bulk actions** — batch/multi-item operations confirmed with scope or impact summary?',
    '',
    '### Review principles',
    '- Ground feedback in the planner check-in and the project codebase — cite existing patterns rather than inventing generic UI preferences.',
    '- Do **not** prescribe style choices the project has not adopted (e.g. `cursor: pointer`, specific flex layouts, canonical card chrome, responsive utility patterns, button label copy).',
    '- Flag missing states and missing safeguards when the plan omits them; recommend consistency with established project conventions.',
    '- When multiple valid patterns exist in the codebase, recommend one and explain the tradeoff.',
  ].join('\n');
}
// fallow-ignore-next-line unused-export
export function renderWebappUxReference(): string { return renderWebappUxHandoffReference(); }
export function getUxReviewTriggerDescription(): string { return 'when the planner check-in proposes user interface changes'; }
