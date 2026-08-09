# Phase P4 — Lifecycle Local

**Status:** Implemented (in review) — [PR #1355](https://github.com/conradkoh/chatroom/pull/1355)  
**Depends on:** [P2](./p2-local-read-models.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P4` — when off, APM uses direct Convex `emit*` mutations.

## Shippability

**Shippable alone:** Yes — with P2 complete; **parallel with P3** (no dependency on P3).

### What ships

- APM emits local lifecycle events; read models update synchronously
- Batched `emit*` via projection (reduced Convex mutation churn)
- Local enhancer queue (replaces Convex pending poll)

### Flag-off guarantee

APM continues direct `api.machines.emit*` / `api.participants.*` mutations — identical to today.

### Progressive rollout

1. **P4 on:** APM appends local events + updates read models; projection worker batches to Convex. Direct mutations disabled on APM hot path.
2. Enhancer: local queue replaces Convex subscriber poll; subscriber **registration** removed in P5 (not P4).

### Toward outcome

Reduces per-tick Convex mutations; lifecycle decisions become local-first.

### Ship checklist

- [ ] Flag off: agent start/stop/exit unchanged
- [ ] Flag on: agent lifecycle E2E; webapp agent status within T3 SLA
- [ ] Enhancer: planner → enhancer handoff spawns via local queue
- [ ] Convex `emit*` call count drops on hot path (log/metric assertion)

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

**Delete:** Defer enhancer subscriber deregistration to [P5-T2](./p5-subscriber-shrink.md). P4 only switches `job-subscriber.ts` to poll local queue when P4 on.

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
