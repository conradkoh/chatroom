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

| Component                  | Path                                              | Status  | Notes                                                               |
| -------------------------- | ------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| HarnessHarnessSelect       | `direct-harness/.../HarnessHarnessSelect.tsx`     | done    | Flat list: `PickerSearch` + `filterPickerItems` + `PickerOptionRow` |
| HarnessAgentSelect         | `direct-harness/.../HarnessAgentSelect.tsx`       | done    | Flat list: `PickerSearch` + `filterPickerItems` + `PickerOptionRow` |
| HarnessWorkspaceSwitcher   | `direct-harness/.../HarnessWorkspaceSwitcher.tsx` | pending |                                                                     |
| DirectHarnessPanel session | `explorer-split-panels/DirectHarnessPanel.tsx`    | pending |                                                                     |
| DirectHarnessView machine  | `direct-harness/.../DirectHarnessView.tsx`        | pending |                                                                     |

### Lower priority (small / contextual enums)

| Component                | Path                                        | Status  | Notes                               |
| ------------------------ | ------------------------------------------- | ------- | ----------------------------------- |
| CreateChatroomForm team  | `components/CreateChatroomForm.tsx`         | pending | Few teams — `searchable={false}` OK |
| AgentSettingsModal tabs  | `components/AgentSettingsModal.tsx`         | pending | `sm:hidden` only, 6 tabs            |
| PullRequestsPanel filter | `workspace/.../PullRequestsPanel.tsx`       | pending | ~4 filters                          |
| RightSplitPanel mode     | `explorer-split-panels/RightSplitPanel.tsx` | skip    | 2 modes, md+ only panel             |

### Refactor (leave it better)

| Component        | Path                              | Status  | Notes                                                 |
| ---------------- | --------------------------------- | ------- | ----------------------------------------------------- |
| ModelFilterPanel | `components/ModelFilterPanel.tsx` | pending | Adopt `ResponsivePickerShell` after foundation proven |

## Implementation slices

| Slice | Owner   | Deliverable                                           | Status  |
| ----- | ------- | ----------------------------------------------------- | ------- |
| 0     | Planner | This plan doc                                         | done    |
| 1     | Builder | Foundation primitives + tests in `components/picker/` | done    |
| 2     | Builder | Pilot: migrate `HarnessModelSelect`                   | done    |
| 3     | Builder | Harness selectors batch                               | done    |
| 4     | Builder | Explorer / direct-harness selects                     | pending |
| 5     | Builder | Forms + panels; refactor `ModelFilterPanel`           | pending |
| 6     | Planner | Review, PR to `release/v1.65.7`                       | pending |

## Testing strategy

- **Foundation**: mock `useIsDesktop` → assert Popover vs Drawer branch; `filterPickerItems` edge cases; `usePickerSearchState` clears on close.
- **Each migration**: update existing component tests; add responsive behavior test where mocks exist.
- **Manual**: mobile viewport — drawer opens, search filters, selection closes picker.

## Learnings / challenges

_(Update as we go.)_

- **2026-07-13**: Two search styles exist today — plain input (`ModelFilterPanel`) and cmdk (`HarnessModelSelectList`). Foundation standardizes the **input chrome** via `PickerSearch`; cmdk remains valid **inside** `PickerScrollBody` for grouped model lists.
- **2026-07-13**: `HarnessModelSelect` migrated. Uses cmdk inside `PickerScrollBody` (no `PickerSearch` on top). Shell popover uses chatroom-local `data-slot="chatroom-popover-content"` slot (not harness-local `data-slot="popover-content"`).
- **2026-07-13**: `HarnessHarnessSelect` and `HarnessAgentSelect` migrated from Radix `Select` to responsive picker. Flat lists use `PickerSearch` + `filterPickerItems` + `PickerOptionRow` pattern. cmdk is reserved for grouped model lists. `PickerOptionRow` added as shared option button, eliminating duplicated option-button markup across future slices.

## Branch / PR

- Base: `release/v1.65.7`
- Feature branch: `feat/responsive-picker-foundation` (slice 1), then same branch or stacked commits for migrations
- Single PR when migrations complete (or foundation PR first if user prefers — default: one PR)
