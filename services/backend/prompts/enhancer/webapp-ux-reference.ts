/**
 * Canonical UX review patterns for enhancer UI proposal review.
 * SSOT — project-agnostic checks embedded in the enhancer→planner template.
 */

/** Handoff-formatted UX reference embedded in the enhancer→planner template. */
export function renderWebappUxHandoffReference(): string {
  return [
    '### UX review checklist',
    'Complete the optional **UX** section in your output when the planner proposes UI changes. Write exactly "Not Applicable." for non-UI tasks. Put code snippets in **Suggested edits** only.',
    '',
    '1. **Flows** — primary action ≤3 clicks? simpler path exists?',
    '2. **Patterns** — matches existing components? recommend one if multiple. mobile vs desktop (responsive variants vs separate mobile UI)?',
    '3. **Layout** — compact title+menu row, description, trailing end-aligned CTA? unnecessary wrappers?',
    '4. **Shortcuts** — consistent with project conventions? gaps or conflicts?',
    '5. **States** — loading spinners/skeletons for async data? error messages on failure? empty states?',
    '6. **Error boundaries** — risky subtrees wrapped so a throw does not crash the whole app? failure isolated from the shell?',
    '7. **Alignment** — traced parent layout before leaf styles? position/height match siblings?',
    '8. **Feedback** — immediate pending state on async actions (e.g. save → button "Saving...")?',
    '9. **Destructive actions** — confirmation dialog before delete/remove/archive/reset/clear or other irreversible/high-impact single actions?',
    '10. **Bulk actions** — confirmation before batch/multi-item operations (with count or impact summary)?',
    '',
    '### Flow complexity',
    '- Primary action ≤3 clicks from entry point',
    '- Extend existing surfaces (palette, settings tab, row action) before new navigation',
    '- Avoid nested modal chains and unjustified multi-step wizards',
    '- Prefer inline actions over navigate-away-and-back',
    '',
    '### Presentation & responsive patterns',
    '- Reuse existing design-system components and established UI patterns before introducing new abstractions',
    '- Match badge/button styling from similar surfaces in the app',
    '- When multiple valid patterns exist, recommend one and explain tradeoff',
    "- Use the project's standard breakpoint(s) for mobile vs desktop",
    '- **Hide/show:** responsive utility classes or equivalent for alternate chrome per viewport',
    '- **Mobile overlay:** full-screen or sheet overlay with backdrop when desktop uses persistent panels',
    '- **Separate mobile UI:** dedicated mobile modal/picker when desktop uses side panel or split view',
    '- **Shared responsive density:** same component with size/density variants per breakpoint',
    '- **Command/search dialogs:** match existing modal/dialog styling; sensible max-width on small screens',
    '',
    '### Layout simplification',
    '- Review card/section layouts for unnecessary rows, nested wrappers, or misaligned actions',
    '- Prefer compact rows: title and overflow menu on one line via flex/grid',
    '- Description on the next line; primary CTA on a trailing row aligned end',
    '- Canonical simplified card pattern:',
    '  ```',
    '  <title>          <overflow-menu>',
    '  <description>',
    '                   <primary-cta aligned end>',
    '  ```',
    '- Use header + action grid or equivalent flex `justify-between`',
    '- Flag multi-row chrome that could collapse (menu on its own row, CTA misaligned vs similar cards)',
    '',
    '### Error & loading states',
    '- Initial fetch: centered loader or skeleton for the content area',
    '- Pagination/infinite scroll: inline loader at scroll edge',
    '- Save/submit mutations: inline success/error feedback beside the trigger control',
    '- Never leave blank panels on fetch failure — show error message or retry affordance',
    '- Disable interactive controls while loading or pending',
    '',
    '### Error boundaries',
    '- Wrap data-dependent or third-party subtrees with error boundaries so a single failure does not unmount the whole app',
    '- Scope boundaries to the failing panel/section, not the entire shell',
    '- Provide fallback UI with a recovery action (retry, reload, or navigate away)',
    '',
    '### Alignment & component hierarchy',
    '- Before styling a leaf component, trace parent flex/grid context',
    '- Match sibling heights and vertical rhythm',
    '- Flag absolute positioning or fixed heights that fight parent layout',
    '- When hierarchy is unclear, inspect the rendered component tree (e.g. DOM inspector or component test snapshot) before deciding leaf styles',
    '',
    '### Fast user feedback',
    '- Async actions triggered by keyboard shortcut or click must show **immediate** UI response',
    '- Canonical pattern: pending local state → button label changes (e.g. "Saving..."), control disabled while in flight',
    '- Show inline error on failure; brief success confirmation optional',
    '- Pair shortcut hints with pending state only when the action shows pending feedback',
    '',
    '### Destructive & bulk action safeguards',
    '- **Destructive actions** (delete, remove, archive, reset, clear, disable) require an explicit confirmation step — never fire immediately from a menu item or button without a dialog',
    "- Use the project's standard confirmation dialog/modal pattern",
    '- Confirmation includes clear title + description of what will happen; primary action styled as destructive when appropriate',
    '- **Bulk actions** (multi-select delete, batch disable, clear-all) require confirmation before execution — show how many items are affected',
    '- Bulk confirm should summarize scope (e.g. "Delete 12 items?") and list material impact when non-obvious',
    '- Flag plans that wire bulk/destructive handlers directly to mutations/API calls without a confirm gate',
    '',
    '### Keyboard shortcuts',
    "- Align proposed shortcuts with the project's existing shortcut catalog and platform conventions (⌘ on macOS, Ctrl on Windows/Linux)",
    '- Avoid conflicting bindings; document new shortcuts when introducing them',
    '- Common patterns: modifier+letter for global commands, Enter to confirm in dialogs, Escape to cancel/close, Shift+Enter for multiline input where applicable',
    '- Flag plans that add shortcuts without checking for conflicts or omit keyboard access for primary actions',
  ].join('\n');
}

/**
 * Backward-compatible alias — the catalog now ships inside the enhancer→planner
 * template rather than a separate envelope block.
 */
// fallow-ignore-next-line unused-export
export function renderWebappUxReference(): string {
  return renderWebappUxHandoffReference();
}

/** One-line trigger condition for when enhancer should run UX review. */
export function getUxReviewTriggerDescription(): string {
  return 'when the planner check-in proposes user interface changes';
}
