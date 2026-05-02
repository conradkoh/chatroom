# Direct Harness UI v2

The direct-harness v2 UI lets you drive harness sessions from the browser without touching the CLI.
It lives as the third icon in the chatroom ActivityBar (alongside the explorer and messages views)
and is scoped to the current chatroom — all sessions belong to a chatroom workspace.

## Location

ActivityBar → third icon → **Direct Harness** view.

## Component Layout

```
+---- Left pane (w-72) ────────────────────────────+  +---- Right pane (flex-1) ──────────────────────+
| WorkspaceSwitcher (border-b)                      |  | Session header (border-b)                     |
| SessionList       (flex-1, scrollable)            |  | SessionMessageStream (flex-1, scrollable)      |
| NewSessionButton  (border-t, shrink-0)            |  | SessionComposer (shrink-0, border-t)           |
+---------------------------------------------------+  +-----------------------------------------------+
```

- **WorkspaceSwitcher** — dropdown to pick the chatroom workspace.
- **SessionList** — lists harness sessions for the selected workspace, sorted newest-first, with status indicators.
- **NewSessionButton** — opens a popover with primary/all-mode agents from `getMachineRegistry`; confirms by calling `openSession`, then auto-selects the new session.
- **SessionMessageStream** — reactive stream of prompt/response messages for the selected session.
- **SessionComposer** — textarea + Send button (Cmd/Ctrl+Enter shortcut) that calls `submitPrompt`. Replaced by a status banner for `closed`/`failed` sessions.

## Backend

The backend is unchanged from v1. See `services/backend/convex/chatroom/directHarness/` for:
- `sessions` — `openSession`, `getSession`, `listSessions`
- `prompts` — `submitPrompt`
- `capabilities` — `getMachineRegistry`
