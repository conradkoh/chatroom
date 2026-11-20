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

## Project roots and ledger are lazy (planned)

- Not yet in the schema. This is the rule the later Machines slices must follow.
- Project roots are user intent stored in Convex (small, at most 20 per machine) and must be added to `MACHINE_SCOPED_TABLES` when they land.
- The repository ledger is owned by the daemon as a local file and is never uploaded autonomously. A snapshot exists only as a transient, TTL'd request row plus chunks created on demand.
- No always-on daemon subscription is added for roots or ledger state; see [daemon request lifecycle](/architecture/daemon-request-lifecycle.md) and [bandwidth at rest across projects](/architecture/bandwidth-at-rest-scaling.md).

## Command-nudge pattern

- To tell a daemon that machine state changed, enqueue one coalesced inbox command with `enqueueMachineCommand` (`services/backend/src/domain/usecase/machine/enqueue-machine-command.ts`).
- Check for a pending `chatroom_machineCommandInbox` row of the same command type first and skip the enqueue when one exists. The daemon fetches current state when it handles the command, so one pending nudge covers later edits.
- No new daemon subscriptions for machine-level notifications.

## Per-row action area (webapp extension point)

- The Machines tab (`apps/webapp/src/app/app/machines/`, a later slice, not yet built) renders each machine row with an action area.
- Future machine-level actions plug into that per-row area and must reuse the backend invariants above: owner check, offline guard where the action mutates a live daemon, and registry registration for any new machine-keyed data.

## Architecture references

- [Daemon request lifecycle](/architecture/daemon-request-lifecycle.md)
- [Bandwidth at rest across projects](/architecture/bandwidth-at-rest-scaling.md)
- Cleanup inventory: [docs/cleanup-policies.md](../../docs/cleanup-policies.md)
