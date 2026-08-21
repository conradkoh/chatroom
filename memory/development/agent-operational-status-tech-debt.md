# Agent operational status — tech debt tracker

Living checklist for Phase 4 cleanup after production backfill completes. Update as items are resolved.

## Open

- [ ] **[medium] Legacy fallback derive paths** — All four Phase 3 readers still fall back to config+machineStatus derivation for pre-backfill chatrooms. Remove after `backfillAgentOperationalStatus` migration runs in production and is verified.
  - `get-agent-statuses.ts`
  - `list-chatroom-agent-overview.ts`
  - `participants.ts` (`getTeamLifecycle` `isAlive`)
  - `machines.ts` (`getAgentOverviewForChatroom` via shared resolver)
- [ ] **[medium] Circuit-open override in get-agent-statuses.ts** — Temporary override when projection row not yet refreshed after config patch. Remove once dual-write is stable.
- [ ] **[low] getTeamLifecycle fallback team role key** — Inline team role key string instead of `buildTeamRoleKey` helper (semantically equivalent).
- [ ] **[low] Redundant projection calls on lifecycle paths** — Some lifecycle mutation paths trigger redundant projection rebuilds; consolidate when touching those files.

## Related

- [Agent operational status projection migration](../migrations/agent-operational-status-projection.md)
- PR #1478 — projection implementation
