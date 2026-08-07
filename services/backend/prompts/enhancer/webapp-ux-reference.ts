/**
 * Canonical webapp UX patterns for enhancer UI proposal review.
 * SSOT — update when shortcuts or responsive conventions change.
 */

/** Handoff-formatted UX reference embedded in the enhancer→planner template. */
export function renderWebappUxHandoffReference(): string {
  return [
    '### UX review checklist',
    'Complete the optional **UX** section in your output when the planner proposes UI changes. Write exactly "Not Applicable." for non-UI tasks. Put code snippets in **Suggested edits** only.',
    '',
    '1. **Flows** — primary action ≤3 clicks? simpler path exists?',
    '2. **Patterns** — matches existing components? recommend one if multiple. mobile vs desktop (md: variants vs separate mobile UI)?',
    '3. **Layout** — compact title+menu row, description, trailing end-aligned CTA? unnecessary wrappers?',
    '4. **Shortcuts** — consistent with catalog below? gaps or conflicts?',
    '5. **States** — loading spinners/skeletons for async data? error messages on failure? empty states?',
    '6. **Error boundaries** — risky subtrees wrapped so a throw does not crash the whole app? failure isolated from the dashboard?',
    '7. **Alignment** — traced parent layout before leaf styles? position/height match siblings? snapshot test to map hierarchy?',
    '8. **Feedback** — immediate pending state on async actions (e.g. ⌘Enter save → button "Saving...")?',
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
    '- Reuse existing components: `CommandPalette`, industrial dialogs, `ChatroomLoader`, timeline row chrome',
    '- Match badge/button patterns from timeline (`BADGE_BASE`, `navButtonClass` in All-tab)',
    '- When multiple valid patterns exist, recommend one and explain tradeoff',
    '- **md: breakpoint** (768px) splits mobile vs desktop',
    '- **Hide/show:** `hidden md:flex` / `flex md:hidden` for alternate chrome',
    '- **Mobile overlay:** fixed sidebar overlay with backdrop (`md:hidden`)',
    '- **Separate mobile UI:** dedicated mobile modal/picker when desktop uses side panel',
    '- **Shared responsive density:** same component, `md:` size variants (`h-7 md:h-9`)',
    '- **Command dialogs:** industrial theme via `commandDialogStyles.ts`, top-anchored, max-w-[90vw]',
    '',
    '### Layout simplification',
    '- Review card/section layouts for unnecessary rows, nested wrappers, or misaligned actions',
    '- Prefer compact rows: title and overflow menu (⋮ `MoreVertical` popover) on one line via flex/grid',
    '- Description on the next line; primary CTA (e.g. "View Details") on a trailing row aligned end',
    '- Canonical simplified card pattern:',
    '  ```',
    '  <title>          <overflow-menu ⋮>',
    '  <description>',
    '                   <primary-cta aligned end>',
    '  ```',
    '- Reuse `CardHeader` + `CardAction` grid (`grid-cols-[1fr_auto]`) or equivalent flex `justify-between`',
    '- Flag multi-row chrome that could collapse (menu on its own row, CTA left-aligned when end-aligned matches existing cards)',
    '',
    '### Error & loading states',
    '- Initial fetch: `ChatroomLoader` centered (see `ChatroomTimelineFeed`, `ConversationSlicePanel`)',
    '- Pagination: `isLoadingOlder` / `isLoadingMore` inline loader at scroll edge',
    '- Save mutations: inline success/error text beside button (`AgentSettingsModal` `saveResult` pattern)',
    '- Never leave blank panels on fetch failure — show error message or retry affordance',
    '- Disable interactive controls while `isLoading` / `isPending`',
    '',
    '### Error boundaries',
    '- Wrap data-dependent or third-party subtrees with `ErrorBoundary` (chatroom) or rely on `SentryErrorBoundary` (root) / `AuthErrorBoundary` (app shell)',
    '- A single component throw must not unmount the entire dashboard — scope boundaries to the failing panel/section',
    '- Provide fallback UI with recovery action (reload button pattern in `ErrorBoundary.tsx`)',
    '',
    '### Alignment & component hierarchy',
    '- Before styling a leaf component, trace parent flex/grid — sticky headers, `grid-cols-[1fr_auto_1fr]` timeline nav, `items-center` vs `items-start`',
    '- Match sibling heights and vertical rhythm (`h-7 md:h-9` density pattern)',
    '- Flag absolute positioning or fixed heights that fight parent layout',
    '- **Planner/builder shortcut:** when hierarchy is unclear, write a vitest inline snapshot (`render` + `toMatchInlineSnapshot`, the repo convention in backend prompt tests) to inspect the full component tree before deciding leaf styles — remove or keep the snapshot based on team preference. Webapp currently has no snapshot-test precedent, so treat this as a diagnostic tool, not a convention to mandate.',
    '',
    '### Fast user feedback',
    '- Async actions triggered by keyboard (`⌘Enter` via `isModEnterKey`) or click must show **immediate** UI response',
    '- Canonical pattern: `isSaving` / `isPending` local state → button label `Saving...`, `disabled` while in flight (`AgentSettingsModal`)',
    '- Show inline error on failure; brief success confirmation optional',
    '- Pair shortcut hints with pending state ("Press ⌘Enter to save" only when save shows pending feedback)',
    '',
    '### Destructive & bulk action safeguards',
    '- **Destructive actions** (delete, remove, archive, reset, clear stuck, disable) require an explicit confirmation step — never fire immediately from a menu item or button without a dialog',
    '- Use `AlertDialog` via `apps/webapp/src/modules/chatroom/components/ui/alert-dialog.tsx` (chatroom) or `@/components/ui/alert-dialog` (app shell)',
    '- Canonical patterns: `LifecycleConfirmDialog` (archive with impact summary), `ProcessesPanel` "Clear stuck commands?", `ChatroomDashboard` archive flow',
    '- Destructive confirm actions use clear title + description of what will happen; primary action styled destructive when appropriate',
    '- **Bulk actions** (multi-select delete, batch disable, clear-all, merge-many) require confirmation before execution — show how many items are affected',
    '- Bulk confirm should summarize scope ("Delete 12 items?", "Disable 3 scheduled prompts") — see `LifecycleConfirmDialog` impact lines',
    '- Flag plans that wire bulk/destructive handlers directly to mutations without a confirm gate',
    '',
    '### Keyboard shortcuts (reference)',
    '| Shortcut | Action |',
    '|----------|--------|',
    '| ⌘K / Ctrl+K | Chatroom switcher |',
    '| ⌘P / Ctrl+P | File selector |',
    '| ⌘⇧P / Ctrl+Shift+P | Command palette (scripts, saved commands) |',
    '| ⌘⇧F / Ctrl+Shift+F | Workspace search |',
    '| ⌘I / Ctrl+I | Attach explorer snippet |',
    '| Enter (desktop, no Shift) | Send message |',
    '| Shift+Enter | New line in composer |',
    '| ⌘Enter / Ctrl+Enter | Confirm/save in modals |',
    '| ⌘S / Ctrl+S | Save in workspace file dialogs |',
    '| Escape | Close modal/dialog |',
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
