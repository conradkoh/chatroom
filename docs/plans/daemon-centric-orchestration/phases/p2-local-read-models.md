# Phase P2 — Local Read Models

**Status:** Not started  
**Depends on:** [P1](./p1-outbox-drain.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P2` — when off, task monitor continues Convex snapshot WS.

## Shippability

**Shippable alone:** Yes — with P1 complete (projection path for read-model sync); P3/P4 not required.

### What ships

- SQLite read models for tasks, participants, agents, handoffs
- Hydration from Convex on startup
- Shadow mode: models stay in sync; task monitor still uses Convex snapshots for decisions

### Flag-off guarantee

No new tables used for orchestration. Task monitor uses `listMachineAssignedTaskSnapshots` WS exactly as today.

### Progressive rollout

1. **Shadow (P2 on, cutover off):** Populate and maintain read models from Convex hydrate + inbound events. Task monitor **continues** Convex snapshot WS for nudge/delivery decisions. Read models used for observability, local-web, and parity tests only.
2. **Cutover (`DAEMON_ORCHESTRATION_P2_CUTOVER` on):** Task monitor and restart orchestrator read local read models; disable Convex snapshot WS subscription.

### Toward outcome

Single local source for orchestration reads — removes Convex WS churn on hot path when cutover enabled.

### Ship checklist

- [ ] Flag off: task monitor behavior unchanged
- [ ] Shadow: read model rows match Convex snapshot after hydrate (parity test)
- [ ] Cutover: nudge/delivery works without snapshot WS; webapp status via P1 projection (T3)
- [ ] Rollback: disable P2 cutover → reverts to Convex WS without data loss

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

### P2-T4 — Task monitor reads local read models (cutover-gated) `[modify]`

**Modify:**

- `packages/cli/src/daemon/entry/task-monitor-runtime.ts` — when `DAEMON_ORCHESTRATION_P2_CUTOVER` on (not merely P2), replace `listMachineAssignedTaskSnapshots` WS `onUpdate` with read model queries + local event updates. When P2 on but cutover off, keep Convex WS; additionally update read models in parallel (shadow).
- `packages/cli/src/daemon/entry/task-monitor/task-monitor-snapshot.ts` — accept local row shape (or adapter from read model)
- `packages/cli/src/daemon/entry/restart-orchestrator.ts` — read tasks from `read-models/tasks.ts` instead of Convex query

**Delete (only when P2 cutover on and verified):**

- Remove hot-path `api.machines.listMachineAssignedTaskSnapshots` subscription in `task-monitor-runtime.ts` (keep behind cutover flag; P2 flag alone does not remove it)

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
- [ ] Shadow mode (P2 on, cutover off) shippable independently

## Rollback

Disable `DAEMON_ORCHESTRATION_P2`; task monitor reverts to Convex snapshot WS.
