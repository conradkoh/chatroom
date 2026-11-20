---
type: best-practice
title: Machine management invariants
description: Tombstone-first machine deletion, the MACHINE_SCOPED_TABLES registry rule, lazy project roots/ledger, command nudges and the per-row Machines action area.
tags: [machines, convex, deletion, registry, daemon]
status: stable
---

# Machine management invariants

## Deletion golden path

- One use case, `startMachineDeletion` (`services/backend/src/domain/usecase/machine/delete-machine.ts`), serves both callers:
  - user: `machines.deleteMachine` (`services/backend/convex/machines.ts`), offline-only (`requireOffline: true`), first purge slice inline with `MACHINE_PURGE_BUDGET`;
  - system: `chatroomCleanup.cleanupMachines` (90 days since `lastSeenAt`), `requireOffline: false`, `inlineBudget: 0`.
- Tombstone-first: in one transaction the use case runs the guards (ownership always; offline proof for user-initiated deletes), inserts a `chatroom_machineDeletions` row (`status: 'purging'`) and deletes the `chatroom_machines` row. With `inlineBudget: 0` the purge is only scheduled.
- Deleting the machine row revokes daemon authority: every daemon mutation authorizes through `requireMachineOwner` → `checkAccess`, whose `getMachineByMachineId` dependency reads `chatroom_machines` (`services/backend/modules/auth/accessCheck.ts`).
- `machines.register` only creates a machine when no `purging` tombstone exists for that `machineId`; otherwise it throws `MACHINE_DELETION_IN_PROGRESS`. Repeating a delete after completion returns `already_deleted`.
- Purge runs in budgeted batches through `machineDeletion.purgeBatch`; an empty verification pass marks the tombstone `completed`. `machineDeletion.sweepMachineDeletions` (every 5 minutes) restarts dead chains, fails them after `MACHINE_PURGE_MAX_RESTARTS` (10), and prunes completed tombstones after `MACHINE_DELETION_RETENTION_MS` (7 days). Failed tombstones are kept.

## Registry rule

- A new machine-keyed table must be added to `MACHINE_SCOPED_TABLES` (or `MACHINE_SCOPED_EXEMPTIONS` with a reason); the coverage spec fails otherwise.
- The spec is `services/backend/src/domain/usecase/machine/machine-scoped-tables.spec.ts`; it also proves every `(table, index)` descriptor pair exists at runtime.
- Registry cost is `1` for small rows and `15` for rows that can be hundreds of KB (blobs, shards, diffs, file content, command runs). The batch stops before the budget is exhausted and reschedules.
- Workspaces are soft-detached (`removedAt`), never hard-deleted, and are the one deliberate exemption that keeps rows carrying a deleted `machineId`. Chatrooms, messages and participants are preserved.
- The 90-day path is the same path: there is no second machine-cascade implementation.

## Project roots and the repository ledger are lazy

- Project roots are built. They live in `chatroom_machineProjectRoots` (registered in
  `MACHINE_SCOPED_TABLES` at `services/backend/src/domain/usecase/machine/machine-scoped-tables.ts`),
  are exposed by `api.machineProjectRoots.list/add/remove`, and are managed from the Machines tab's
  expanded card. Roots are user intent stored in Convex (at most `MAX_PROJECT_ROOTS`, 20 per machine);
  `add` enqueues at most one coalesced `daemon.syncProjectRoots` nudge and requires the machine online,
  while `remove` works offline.
- The daemon-local repository ledger is built in the CLI: one ledger service per daemon process
  (`packages/cli/src/daemon/entry/repository-ledger-runtime.ts`), refreshed on daemon boot and on the
  `daemon.syncProjectRoots` nudge, backed by the atomic local store
  (`packages/cli/src/daemon/infrastructure/local/repository-ledger-store.ts`). The ledger is never
  uploaded autonomously.
- Built: the on-demand ledger snapshot (request row, chunked pages, 10-min snapshot TTL, 5-min
  cleanup cron) and bulk chatroom create (`chatrooms.createManyWithWorkspace`). See
  [repository ledger feature note](../../docs/features/repository-ledger.md).
- Built: the Repositories section UI and its webapp hooks (`useRepositoryLedger`,
  `useBulkCreateChatrooms`).
- No always-on daemon subscription is added for roots or ledger state; see
  [daemon request lifecycle](/architecture/daemon-request-lifecycle.md) and
  [bandwidth at rest across projects](/architecture/bandwidth-at-rest-scaling.md).

## Repository ledger snapshot and bulk create

- Snapshots are request/response and transient. They are never a durable synced table.
- Bulk create has one creation path (`createChatroomWithWorkspace`). The UI must not add a parallel one.
- `invalidPathCount` means "entries the snapshot omits" and is read from the request row.
- Ledger tables are in `MACHINE_SCOPED_TABLES`, so a machine delete purges them.

## Command-nudge pattern

- To tell a daemon that machine state changed, enqueue one coalesced inbox command with `enqueueMachineCommand` (`services/backend/src/domain/usecase/machine/enqueue-machine-command.ts`).
- Check for a pending `chatroom_machineCommandInbox` row of the same command type first and skip the enqueue when one exists. The daemon fetches current state when it handles the command, so one pending nudge covers later edits.
- No new daemon subscriptions for machine-level notifications.

## Per-row action area (webapp extension point)

- The Machines tab is built at `apps/webapp/src/app/app/machines/` (feature code in
  `apps/webapp/src/modules/chatroom/features/machines/`). Each card has a header action area
  (`MachineActionsMenu`, fed by descriptors in `machineActions.ts`) and an expandable body; project
  roots is the first body section and mounts only while the card is expanded.
- Future machine-level actions plug into that per-row area and must reuse the backend invariants above: owner check, offline guard where the action mutates a live daemon, and registry registration for any new machine-keyed data.

## Architecture references

- [Daemon request lifecycle](/architecture/daemon-request-lifecycle.md)
- [Bandwidth at rest across projects](/architecture/bandwidth-at-rest-scaling.md)
- Cleanup inventory: [docs/cleanup-policies.md](../../docs/cleanup-policies.md)
