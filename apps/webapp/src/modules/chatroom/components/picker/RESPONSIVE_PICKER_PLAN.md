# Responsive Picker Migration Plan

> Living document — update this file as slices complete and learnings emerge.

## Problem

Radix `Select` and custom `Popover` pickers render portaled menus that clip or sit off-screen on mobile. PR #897 (`ModelFilterPanel`) solved this for the model blacklist filter with a **Popover on desktop / Drawer on mobile** split, plus search.

We need the same UX for all chatroom-module popover-based selects, with a **composable foundation** so migrations stay small and consistent.

## Goals

1. **Foundation first** — shared primitives, not a monolithic `<ResponsiveSelect options={...} />`.
2. **Search by default** when lists can grow; opt out for tiny fixed enums.
3. **Composition** — shell + search + scroll body + caller-owned options.
4. **Tests** — unit tests for shell branching, search state, and filter helpers.
5. **No admin scope** — skip `apps/webapp/src/app/admin/**` (upstream).

## Non-goals

- Info popovers (`WorkspaceBottomBar` remote/repo menus, `CommitStatusIndicator`) — not selects.
- Changing upstream shadcn primitives in `@/components/ui/`.
- Forcing cmdk `Command` for every picker (simple lists can use filtered buttons).

## Reference implementations

| File                                            | Pattern                                | Search                            |
| ----------------------------------------------- | -------------------------------------- | --------------------------------- |
| `components/ModelFilterPanel.tsx`               | Popover/Drawer + shared `panelContent` | Plain `<input>`                   |
| `direct-harness/.../HarnessModelSelect.tsx`     | Popover only (needs migration)         | cmdk via `HarnessModelSelectList` |
| `direct-harness/.../HarnessModelSelectList.tsx` | Command groups                         | cmdk                              |

Breakpoint: `useIsDesktop()` default **1024px** (same as `ModelFilterPanel`).

## Foundation architecture (composition)

```
ResponsivePickerShell     ← Popover (desktop) | Drawer (mobile); owns open state wiring
├── PickerPanelHeader?    ← optional title + actions row (like Model Visibility header)
├── PickerSearch?         ← standardized search input; omitted when searchable=false
└── PickerScrollBody      ← max-height scroll region; children = options / custom UI
```

Supporting utilities:

- `usePickerSearchState` — `{ searchTerm, setSearchTerm, handleOpenChange }`; clears search on close.
- `filterPickerItems(items, term, getSearchText)` — pure filter for non-cmdk lists.

Added helper (slice 3): `PickerOptionRow` for consistent option button styling in flat list pickers.

### API sketch

```tsx
const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(onOpenChange);

<ResponsivePickerShell
  open={open}
  onOpenChange={handleOpenChange}
  trigger={<button>...</button>}
  title="Select harness"
  contentClassName="w-72 p-0"
>
  <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search…" />
  <PickerScrollBody>
    {filterPickerItems(items, searchTerm, (i) => i.label).map(...)}
  </PickerScrollBody>
</ResponsivePickerShell>
```

## Migration inventory

Status legend: `pending` | `in-progress` | `done` | `skip`

### High priority (popover custom selects)

| Component          | Path                                        | Status | Notes                                                            |
| ------------------ | ------------------------------------------- | ------ | ---------------------------------------------------------------- |
| HarnessModelSelect | `direct-harness/.../HarnessModelSelect.tsx` | done   | cmdk inside `PickerScrollBody`; uses chatroom-local popover slot |

### Medium priority (Radix Select, dynamic lists)

| Component                  | Path                                              | Status | Notes                                                               |
| -------------------------- | ------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| HarnessHarnessSelect       | `direct-harness/.../HarnessHarnessSelect.tsx`     | done   | Flat list: `PickerSearch` + `filterPickerItems` + `PickerOptionRow` |
| HarnessAgentSelect         | `direct-harness/.../HarnessAgentSelect.tsx`       | done   | Flat list: `PickerSearch` + `filterPickerItems` + `PickerOptionRow` |
| HarnessWorkspaceSwitcher   | `direct-harness/.../HarnessWorkspaceSwitcher.tsx` | done   | Flat list with search; keeps empty-state div                        |
| DirectHarnessPanel session | `explorer-split-panels/DirectHarnessPanel.tsx`    | done   | Preserves responsive trigger (`@container`/`@md:`) + New session    |
| DirectHarnessView machine  | `direct-harness/.../DirectHarnessView.tsx`        | done   | Register dialog machine picker; no search (small list)              |

### Lower priority (small / contextual enums)

| Component                | Path                                        | Status | Notes                                          |
| ------------------------ | ------------------------------------------- | ------ | ---------------------------------------------- |
| CreateChatroomForm team  | `components/CreateChatroomForm.tsx`         | done   | Search + option row; preserves Enter-to-submit |
| AgentSettingsModal tabs  | `components/AgentSettingsModal.tsx`         | done   | No search (6 tabs); `sm:hidden` only           |
| PullRequestsPanel filter | `workspace/.../PullRequestsPanel.tsx`       | done   | No search (3 options)                          |
| RightSplitPanel mode     | `explorer-split-panels/RightSplitPanel.tsx` | skip   | 2 modes, md+ only panel                        |

### Refactor (leave it better)

| Component        | Path                              | Status | Notes                                                             |
| ---------------- | --------------------------------- | ------ | ----------------------------------------------------------------- |
| ModelFilterPanel | `components/ModelFilterPanel.tsx` | done   | Uses `ResponsivePickerShell`; removed Popover/Drawer/useIsDesktop |

## Implementation slices

| Slice | Owner   | Deliverable                                           | Status |
| ----- | ------- | ----------------------------------------------------- | ------ |
| 0     | Planner | This plan doc                                         | done   |
| 1     | Builder | Foundation primitives + tests in `components/picker/` | done   |
| 2     | Builder | Pilot: migrate `HarnessModelSelect`                   | done   |
| 3     | Builder | Harness selectors batch                               | done   |
| 4     | Builder | Explorer / direct-harness selects                     | done   |
| 5     | Builder | Forms + panels; refactor `ModelFilterPanel`           | done   |
| 6     | Planner | Review, PR to `release/v1.65.7`                       | done   |

## Testing strategy

- **Foundation**: mock `useIsDesktop` → assert Popover vs Drawer branch; `filterPickerItems` edge cases; `usePickerSearchState` clears on close.
- **Each migration**: update existing component tests; add responsive behavior test where mocks exist.
- **Manual**: mobile viewport — drawer opens, search filters, selection closes picker.

## Learnings / challenges

_(Update as we go.)_

- **2026-07-13**: Two search styles exist today — plain input (`ModelFilterPanel`) and cmdk (`HarnessModelSelectList`). Foundation standardizes the **input chrome** via `PickerSearch`; cmdk remains valid **inside** `PickerScrollBody` for grouped model lists.
- **2026-07-13**: `HarnessModelSelect` migrated. Uses cmdk inside `PickerScrollBody` (no `PickerSearch` on top). Shell popover uses chatroom-local `data-slot="chatroom-popover-content"` slot (not harness-local `data-slot="popover-content"`).
- **2026-07-13**: `HarnessHarnessSelect` and `HarnessAgentSelect` migrated from Radix `Select` to responsive picker. Flat lists use `PickerSearch` + `filterPickerItems` + `PickerOptionRow` pattern. cmdk is reserved for grouped model lists. `PickerOptionRow` added as shared option button, eliminating duplicated option-button markup across future slices.
- **2026-07-13**: Slice 4: `HarnessWorkspaceSwitcher` migrated (keeps empty-state div short-circuit), `DirectHarnessPanel` session picker migrated (preserves responsive `@container`/`@md:` trigger styling, New session sentinel as `PickerOptionRow`), `DirectHarnessView` register dialog machine picker migrated (compact button without search for small lists).
- **2026-07-13**: Slice 5: Fixed hooks violations (moved useState/usePickerSearchState before conditional returns in HarnessWorkspaceSwitcher and DirectHarnessPanel). Migrated CreateChatroomForm team picker (with search, Enter-to-submit preserved via open state), AgentSettingsModal mobile tab picker (no search, 6 tabs), PullRequestsPanel filter (no search, 3 options). Refactored ModelFilterPanel to use ResponsivePickerShell — removed duplicated Popover/Drawer/useIsDesktop branching.
- **2026-07-13**: Slice 6: Planner review caught remaining `useMemo` after early return in HarnessWorkspaceSwitcher (fixed). PR #911 opened to `release/v1.65.7`.

## Branch / PR

- Base: `release/v1.65.7`
- Feature branch: `feat/responsive-picker-foundation` (slice 1), then same branch or stacked commits for migrations
- Single PR when migrations complete (or foundation PR first if user prefers — default: one PR)
