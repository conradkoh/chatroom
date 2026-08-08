# Phase P2 — Local Read Models

**Status:** Not started  
**Depends on:** [P1](./p1-outbox-drain.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P2` — when off, task monitor continues Convex snapshot WS.

---

## Goal

Materialize orchestration read models (tasks, participants, agents, handoffs) in SQLite. Task monitor, native delivery, and restart orchestrator read local state instead of `listMachineAssignedTaskSnapshots` WS/HTTP.

## Prerequisites

- P1 outbox drain proven.
- Review overview.md §3 `infrastructure/persistence/read-models/`.

---

## Todos

### P2-T1 — Extend SQLite schema for read models `[modify]`

**Modify:**

- `packages/cli/src/daemon/infrastructure/persistence/schema.ts` — add tables:
  - `read_model_tasks` (chatroom_id, role, task_id, status, execution_kind, updated_at, …)
  - `read_model_participants` (chatroom_id, role, turn_phase, last_seen_at, …)
  - `read_model_agents` (machine_id, role, pid, harness_session_id, …)
  - `read_model_handoffs` (chatroom_id, pending_next_role, message_id, …)
- Migration/version bump in `open-database.ts` if versioning exists

**Verify:**

- `pnpm --filter chatroom-cli test persistence-store` passes
- Fresh daemon start creates new tables; existing events.sqlite migrates cleanly

### P2-T2 — Implement read model repositories `[new]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/persistence/read-models/tasks.ts`
- `packages/cli/src/daemon/infrastructure/persistence/read-models/participants.ts`
- `packages/cli/src/daemon/infrastructure/persistence/read-models/agents.ts`
- `packages/cli/src/daemon/infrastructure/persistence/read-models/handoffs.ts`
- `packages/cli/src/daemon/infrastructure/persistence/read-models/index.ts`
- `packages/cli/src/daemon/application/ports/read-models.port.ts` — interfaces for use cases

**Verify:**

- Unit tests per repository: upsert, query by chatroom/role, list pending
- Read models updated synchronously in tests (no async projection lag for local reads)

### P2-T3 — Hydrate read models from Convex (one-time bootstrap) `[new]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/persistence/read-models/hydrate-from-convex.ts` — on daemon start (P2 flag on), fetch `listMachineAssignedTaskSnapshots` + participant rows once, populate SQLite

**Modify:**

- `packages/cli/src/daemon/entry/init-daemon.ts` — call hydrate on startup when P2 enabled

**Verify:**

- After hydrate, local task rows match Convex snapshot for same machine
- Re-hydrate is idempotent (upsert semantics)

### P2-T4 — Task monitor reads local read models `[modify]`

**Modify:**

- `packages/cli/src/daemon/entry/task-monitor-runtime.ts` — when P2 on, replace `listMachineAssignedTaskSnapshots` WS `onUpdate` with read model queries + local event updates
- `packages/cli/src/daemon/entry/task-monitor/task-monitor-snapshot.ts` — accept local row shape (or adapter from read model)
- `packages/cli/src/daemon/entry/restart-orchestrator.ts` — read tasks from `read-models/tasks.ts` instead of Convex query

**Delete (when P2 flag on and verified):**

- Remove hot-path `api.machines.listMachineAssignedTaskSnapshots` subscription in `task-monitor-runtime.ts` (keep behind flag off)

**Verify:**

- `pnpm --filter chatroom-cli test task-monitor` passes
- Manual: user message → task appears in local read model → nudge fires without Convex snapshot WS
- `task-monitor-send-message-signal.test.ts` still passes (update mocks for local path)

### P2-T5 — Project read model changes to Convex `[modify]`

**Modify:**

- `packages/cli/src/daemon/infrastructure/projection/convex/handlers/project-task-status.ts` — sync from read model updates
- `packages/cli/src/daemon/infrastructure/projection/convex/handlers/project-agent-status.ts` — participant/agent projection (T3)

**Verify:**

- Webapp task status updates within T3 SLA after local read model write
- `syncMachineAssignedTaskSnapshotsMutation` call count drops on hot path (metric/log assertion in test)

---

## Definition of done

- [ ] Task monitor orchestration loop runs from SQLite read models when P2 on
- [ ] Convex snapshot WS not required for nudge/delivery decisions
- [ ] Webapp still sees task/agent status via projection (T3)
- [ ] `pnpm turbo run typecheck test --filter=chatroom-cli` green

## Rollback

Disable `DAEMON_ORCHESTRATION_P2`; task monitor reverts to Convex snapshot WS.
