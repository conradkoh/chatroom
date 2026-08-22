# Agent operational status — tech debt tracker

Living checklist for projection reader cleanup. Update as items are resolved.

## Decisions (2026-08-22)

- **No CI backfill:** `backfillAgentOperationalStatus` removed from `migrations.runAll`. Projection tables deploy empty; dual-write populates on activity.
- **Projection-only readers:** Phase 4 fallback derive paths removed in same branch. Missing rows → stopped/false/none defaults.

## Open

- [x] **[medium] Legacy fallback derive paths** — Removed in branch. Readers are projection-only; safe defaults when rows missing. Cold-start: dual-write populates projections on agent activity; no CI backfill.
  - `get-agent-statuses.ts`
  - `list-chatroom-agent-overview.ts`
  - `participants.ts` (`getTeamLifecycle` `isAlive`)
  - `machines.ts` (`getAgentOverviewForChatroom` via shared resolver)
- [x] **[medium] Circuit-open override in get-agent-statuses.ts** — Removed. Circuit state flows through projection write path (`deriveRoleOperationalState`); reader is projection-only.
- [ ] **[low] getTeamLifecycle fallback team role key** — Inline team role key string instead of `buildTeamRoleKey` helper (semantically equivalent).
- [ ] **[low] Redundant projection calls on lifecycle paths** — Some lifecycle mutation paths trigger redundant projection rebuilds; consolidate when touching those files.

## Related

- [Agent operational status projection migration](../migrations/agent-operational-status-projection.md)
- PR #1478 — projection implementation
