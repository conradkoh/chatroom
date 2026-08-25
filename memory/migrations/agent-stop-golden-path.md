---
type: decision-log
title: Agent stop golden path
description: Consolidate agent stop into one durable command aggregate with confirmed harness termination and projection-driven UI.
tags: [agents, daemon, convex, migration, stop, lifecycle]
status: active
---

# Agent stop golden path

## Context

- Audit: `docs/audit/stop-command-daemon-report.md`
- Related: `memory/migrations/agent-operational-status-projection.md`

## Invariants

1. desired stop ≠ physical stop
2. targetKey = machineId + normalizedRole + pid
3. completion follows lifecycle-fact delivery
4. lifecycle outbox alive until shutdown stops finish

## Stage 1 — Consolidate (golden path, migrate callers)

- [x] Slice 1: migration tracker + daemon type contracts + `stopAgentConfirmed` / `stopAgentScope` use cases + tests
- [x] Slice 2: wire `stopAgentConfirmed` into `AgentProcessManager.doStop`; explicit harness; typed errors; remove swallowed catch
- [x] Slice 3: route daemon inbox handler through `stopAgentScope`; keep `agent.requestStop` payload temporarily
- [x] Slice 4: migrate backend producers (`stop-agent.ts`, `ensure-only-agent-for-role.ts`, `update-team.ts`, `teamRoleKey.ts`) to golden-path stop intent (no eager PID clear / exit / task release)
- [x] Slice 5: migrate UI (`ChatroomSidebar`, `ChatroomDashboard`, `AgentControls`, command palette) to single mutation hook (stub mutation OK if schema not ready)
- [ ] Slice 6: delete legacy paths after `rg` shows zero producers

## Stage 2 — Durable command + confirmed behavior

- [ ] Convex schema: command / machine execution / target tables
- [ ] `api.agentStops.request` + daemon begin/report/complete/redrive
- [ ] Inbox payload `agent.stopScope` with stable `stopCommandId`
- [ ] PID/revision-gated `agentExited`; task release only on applied fact
- [ ] Stop progress on role/summary projections; UI reactive `stopState`
- [ ] Daemon shutdown order fix; idempotency integration tests
- [ ] PR to `master`

## Deviations

- Slice 4: `teamRoleKey.deleteStaleTeamAgentConfigs` inlines inbox enqueue (avoids convex→domain import cycle); behavior matches `requestAgentStop` intent.
- Slice 4: `machines.sendCommand` stop-agent no longer calls eager exit/PID clear (delegates to `requestAgentStop`).

## Verification log

- Slice 1: `pnpm --dir packages/cli exec vitest run src/daemon/domain/usecase/stop-agent-confirmed.test.ts src/daemon/domain/usecase/stop-agent-scope.test.ts` (10 passed); `pnpm --dir packages/cli typecheck` (passed).
- Slice 2: `pnpm --dir packages/cli exec vitest run src/daemon/infrastructure/agent-process-manager/agent-process-manager.test.ts` (103 passed); `pnpm --dir packages/cli typecheck` (passed).
- Slice 3: scoped inbox stop wiring implemented; verification pending.
- Slice 4: `pnpm --dir services/backend exec vitest run ...` (16 passed).
- Slice 5: `pnpm --dir apps/webapp exec vitest run src/modules/chatroom/components/ChatroomSidebar.test.tsx` (15 passed).
