# Phase P4 — Lifecycle Local

**Status:** Not started  
**Depends on:** [P2](./p2-local-read-models.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P4` — when off, APM uses direct Convex `emit*` mutations.

---

## Goal

Agent process manager emits local domain lifecycle events; read models update synchronously; projection worker batches `machines.emit*` and `participants.*` to Convex. Reduces mutation churn on the hot path.

## Prerequisites

- P2 read models (agents, participants).
- Review discovery §4.2.2 agent-process-manager mutation table.

---

## Todos

### P4-T1 — Domain lifecycle events `[new]`

**Implement:**

- `packages/cli/src/daemon/domain/events/agent-lifecycle.ts` — AgentStarted, AgentExited, TurnEnded, SpawnFailed, SessionResumed, etc.
- `packages/cli/src/daemon/application/ports/agent-lifecycle.port.ts`
- `packages/cli/src/daemon/application/use-cases/agents/handle-turn-end.ts` — local missed-handoff reminder scheduling
- `packages/cli/src/daemon/application/use-cases/agents/start-agent.ts`
- `packages/cli/src/daemon/application/use-cases/agents/stop-agent.ts`

**Verify:**

- Unit tests for turn-end → reminder injection without Convex round-trip

### P4-T2 — Refactor agent-process-manager to emit local events `[modify]`

**Modify:**

- `packages/cli/src/daemon/infrastructure/agent-process-manager/agent-process-manager.ts` — replace direct `api.machines.emit*` / `api.participants.handleNativeAgentEnd` calls with event append + read model update

**Delete (when P4 on):**

- Direct Convex mutation imports in APM hot path (grep `api.machines.emit` in file)

**Verify:**

- `pnpm --filter chatroom-cli test agent-process-manager` passes
- Agent start/stop/exit scenarios produce correct local read model state
- Convex `emit*` called only from projection worker (assert in integration test)

### P4-T3 — Batch lifecycle projection handlers `[new]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/projection/convex/handlers/project-agent-status.ts` — batch multiple lifecycle events per flush window (T1/T2 per sync-policy)
- `packages/cli/src/daemon/infrastructure/projection/convex/mappers/agent-lifecycle.mapper.ts`

**Verify:**

- High-frequency heartbeats aggregated (T1) — `participants.updateTokenActivity` not called per tick
- Task/agent/message status still T3 immediate

### P4-T4 — Local enhancer queue `[new]`

**Implement:**

- `packages/cli/src/daemon/application/ports/enhancer-queue.port.ts`
- `packages/cli/src/daemon/application/use-cases/enhancer/enqueue-enhancer-job.ts`
- `packages/cli/src/daemon/application/use-cases/enhancer/process-enhancer-job.ts`
- `packages/cli/src/daemon/infrastructure/persistence/enhancer-queue.ts` (or table in schema.ts)

**Modify:**

- `packages/cli/src/daemon/entry/enhancer/job-subscriber.ts` — when P4 on, poll local queue instead of Convex `daemon.enhancer.index.pendingForMachine`
- `packages/cli/src/daemon/application/use-cases/handoff/execute-handoff.ts` — enqueue enhancer locally on planner→enhancer handoff

**Delete (when P4 on and verified):**

- `packages/cli/src/daemon/infrastructure/convex/subscribers/enhancer-job.ts` registration (move to P5)

**Verify:**

- Planner → enhancer handoff spawns enhancer without Convex pending queue
- Webapp enhancer visibility via projection only

### P4-T5 — Restart orchestrator local state machine `[modify]`

**Modify:**

- `packages/cli/src/daemon/application/use-cases/restart/orchestrate-restart.ts` — `[migrate]` from `entry/restart-orchestrator.ts`
- `packages/cli/src/daemon/entry/restart-orchestrator.ts` — thin wrapper or delete after migration

**Verify:**

- `pnpm --filter chatroom-cli test restart-orchestrator` passes
- `emitRestartPhase` / `emitRestartCompleted` only via projection

---

## Definition of done

- [ ] APM hot path has zero direct Convex mutations when P4 on
- [ ] Enhancer queue fully local
- [ ] Webapp agent status realtime (T3) preserved
- [ ] `pnpm turbo run typecheck test --filter=chatroom-cli` green

## Rollback

Disable `DAEMON_ORCHESTRATION_P4`; APM reverts to direct Convex mutations.
