/**
 * Canonical webapp UX patterns for enhancer UI proposal review.
 * SSOT — update when shortcuts or responsive conventions change.
 */

/** Markdown reference block included in enhancer task envelope <ux-reference>. */
export function renderWebappUxReference(): string {
  return [
    '## Webapp UX reference (chatroom)',
    '',
    'Use when the planner proposes user interface changes.',
    '',
    '### UX review checklist',
    'Report findings in **Recommendations** (abstract bullets — no code). Write "Not Applicable." for non-UI tasks.',
    '1. **Flows** — primary action ≤3 clicks? simpler path exists?',
    '2. **Patterns** — matches existing components? recommend one if multiple. mobile vs desktop (md: variants vs separate mobile UI)?',
    '3. **Layout** — compact title+menu row, description, trailing end-aligned CTA? unnecessary wrappers?',
    '4. **Shortcuts** — consistent with catalog below? gaps or conflicts?',
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

/** One-line trigger condition for when enhancer should run UX review. */
export function getUxReviewTriggerDescription(): string {
  return 'when the planner check-in proposes user interface changes';
}
