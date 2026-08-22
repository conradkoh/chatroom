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
- [x] **[low] getTeamLifecycle fallback team role key** — Replaced inline team role key with `buildTeamRoleKey`.
- [x] **[low] Redundant projection calls on lifecycle paths** — `refreshSnapshotDeliveryConfigForChatroomRole` replaces full chatroom reprojection on agent start/restart.

## Next — daemon task-inbox decoupling (2026-08-22) (complete — merged in #1481)

Master #1479 added `MachineTaskSnapshotState.setDesiredState` as a workaround because agent config changes don't emit task signals. User direction: **do not denormalize agent desired state into task snapshots**; use operational projection as SSOT and wire reactive delivery transitions.

See [agent operational status daemon integration plan](./agent-operational-status-daemon-integration.md) for research, edge case analysis, and phased plan (merge master → agent read model → decouple delivery → slim snapshots).

- [x] **[high] Merge master + reopen PR #1478 → `release/v1.98.8` (#1480)** — absorb #1479 inbox workaround; keep daemon operational backfill on bootstrap
- [x] **[high] Replace `setDesiredState` workaround** — daemon reads `chatroom_agentRoleOperationalStatus`; reactive reconcile on status transitions
- [x] **[medium] Pending-task-on-restart regression test** — task released to pending delivers after agent restart without snapshot `desiredState` hack

## Open — participant status / STOPPING (follow-up PR)

- [x] **[medium] Participant status race on stop** — ignore `agent.waiting` / `get-next-task:started` participant updates when `desiredState=stopped` (fix/agent-stop-status-race).
- [x] **[low] Remove STOPPING UI label** — show OFFLINE when `desiredState=stopped` regardless of `lastStatus`.

## Related

- [Agent operational status projection migration](../migrations/agent-operational-status-projection.md)
- [Agent operational status daemon integration plan](./agent-operational-status-daemon-integration.md)
- PR #1478 — projection implementation
- PR #1479 — task inbox recoverable delivery (master workaround to replace)
- PR #1481 — operational projection + daemon integration (squash-merged to `release/v1.98.8`)
