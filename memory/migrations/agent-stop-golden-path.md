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
- PR: https://github.com/conradkoh/chatroom/pull/1506

## Invariants

1. desired stop ≠ physical stop
2. targetKey = machineId + normalizedRole + pid
3. completion follows lifecycle-fact delivery
4. lifecycle outbox alive until shutdown stops finish

## Stage 1 — Consolidate (golden path, migrate callers)

- [x] Slice 1: migration tracker + daemon type contracts + `stopAgentConfirmed` / `stopAgentScope` use cases + tests
- [x] Slice 2: wire `stopAgentConfirmed` into `AgentProcessManager.doStop`; explicit harness; typed errors; remove swallowed catch
- [x] Slice 3: route daemon inbox handler through `stopAgentScope`; keep `agent.requestStop` payload temporarily
- [x] Slice 4: migrate backend producers to golden-path stop intent (no eager PID clear / exit / task release)
- [x] Slice 5: migrate UI to `useAgentStop` + `api.agentStops.request` (stub mutation)
- [x] Slice 6: delete legacy daemon local stop handler; zero UI `sendCommand` stop-agent producers

### Stage 1 implementation deviations

- [x] `teamRoleKey.deleteStaleTeamAgentConfigs` — moved to domain usecase (`delete-stale-team-agent-configs.ts`); cycle broken (`896a18a0e`)
- [x] `machines.sendCommand` stop-agent shim removed; tests use `api.agentStops.request` (`f79ccca8c`, `1cca0ac69`)

## Pre-Stage 2 — Cleanup before durable command work

Small, low-risk cleanups that do not require the aggregate schema. Do these first (or in parallel with schema design).

- [x] **Reason enum alignment** — `agent.ts` SSOT; legacy inbox reasons mapped at daemon boundary (`f79ccca8c`)
- [x] **Remove `sendCommand` stop-agent shim** — production branch deleted; integration tests migrated (`f79ccca8c`, `1cca0ac69`, `74bc3950f`)
- [x] **Remove webapp `stop-agent` type** — removed from `SendCommandArgs` (`f79ccca8c`)
- [x] **Break `teamRoleKey` import cycle** — `delete-stale-team-agent-configs.ts` in domain (`896a18a0e`)
- [x] **Verify Slice 3** — `on-request-stop-agent` + `stop-agent-scope-adapter` tests pass (9 CLI tests, 2026-08-25)
- [ ] **Infra (out of band)** — pre-push hook suite failures; backlog `ps739rcf3905vy52wermd8wm7d8d4ss3`

## Stage 2 — Durable command + confirmed behavior

### Slice A — Schema & aggregate (resolved)

- [x] Convex tables: command aggregate + per-machine execution + per-target rows
- [x] Extend `services/backend/src/domain/entities/agent-stop-command.ts` validators to match chosen schema (Convex validators + shared pure helpers)
- [x] **Tech debt:** [low] shared stop contracts in `@workspace/shared/domain/agent-stop-command` (`f79ccca8c`)

### Slice B — Backend API & inbox migration

- [x] Upgrade `api.agentStops.request` from stub to create durable `AgentStopCommand` + fan-out machine executions
- [x] Inbox payload `agent.stopScope` with stable `stopCommandId` (replace transient `agent.requestStop`)
- [x] Daemon begin / report-target / complete / redrive mutations
- [x] **Tech debt:** [low] `stopAgentScopeWithBracket` removed; `runRoleScopedStop` delegates to `stopAgentScope` (`74bc3950f`)

### Slice C — Confirmed lifecycle side effects

- [x] PID/revision-gated `agentExited`; clear PID only when revision matches
- [x] Task release only on applied lifecycle fact (not on stop request)
- [x] `deriveAgentRoleViewState` must not treat `desiredState !== 'running'` as stopped while PID alive

### Slice D — UI reactive stop state

- [x] Project `stopState` on role/summary views (pending / stopping / stopped / failed)
- [x] `useAgentStop` reads command status reactively; no optimistic "Stopped" toasts
- [x] **UX (resolved):** keep current per-surface patterns — inline stop in `AgentControls`, existing AlertDialogs for stop-all; no shared `AgentStopConfirmDialog`

### Slice E — Daemon hardening

- [x] **Tech debt:** [medium] `agent-lifecycle-port-adapters` harness stop routes via slot.harness metadata (audit §9.2)
- [x] Daemon shutdown uses durable chatroom-scoped stop intent; lifecycle outbox stays alive until shutdown stops finish
- [x] Idempotency + revision-gating integration tests (`project-agent-lifecycle-fact.spec.ts`, `stop-agent.spec.ts` — Slice C + tech-debt verification)
- [ ] PR to `master` (open: https://github.com/conradkoh/chatroom/pull/1506)
- [ ] **Optional:** dedicated unit tests for harness routing, shutdown orchestration, daemon-runtime outbox ordering (covered by typecheck + integration suites; not blocking)

## Resolved decisions

| Decision                          | Resolution                                                                                                                                                       | Date       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Single-role stop confirmation UX  | **Keep current UX** — inline stop button in `AgentControls`; no new shared `AgentStopConfirmDialog`. Stop-all keeps existing AlertDialog in `ChatroomDashboard`. | 2026-08-25 |
| Sidebar agent vs command-run stop | **Separate** — agent stop via `useAgentStop`; command runs via `stopAllCommandRunsForChatroom` (Stage 1)                                                         | 2026-08-25 |
| Stage 1 eager cleanup             | **Removed** — PID/participant/task side effects deferred to daemon-confirmed lifecycle fact                                                                      | 2026-08-25 |

## Chosen schema

The signed-off Option C model uses three tables:

- `chatroom_agentStopCommands`: `chatroomId`, `scope`, `scopeKey`, `reason`, `requestedBy`, `status`, timestamps.
- `chatroom_agentStopMachineExecutions`: one row per command and machine, with inbox ID, status, claim/completion timestamps, and error.
- `chatroom_agentStopTargets`: one row per PID target with machine, role, target/revision keys, status, outcome, and error.

`chatroom` scope covers all running agents across all bound machines. Daemon shutdown creates one command per chatroom. A newer stop request supersedes all pending or processing stop commands for that chatroom, regardless of scope key. UI stop-in-progress remains per-role in the agent panel only.

### Resolved schema decisions

| Decision                | Resolution                                                                         | Date       |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------- |
| Table model             | Command + machine execution + target rows (Option C)                               | 2026-08-25 |
| Chatroom scope          | All running agents in the chatroom across all bound machines                       | 2026-08-25 |
| Daemon shutdown         | One stop command per chatroom                                                      | 2026-08-25 |
| Reason enum SSOT        | `agent.ts` `AGENT_STOP_REASONS` literals                                           | 2026-08-25 |
| Double-stop idempotency | Per-chatroom supersede: newer request terminalizes all pending/processing commands, regardless of scope key | 2026-08-25 |
| UI stop-in-progress     | Per-role in agent panel only; no chatroom-level sidebar spinner                    | 2026-08-25 |

<!-- Rejected design alternatives and open questions were removed after approval. -->

<!--

**Why your input is needed:** Stage 2 is not a pure refactor — it commits to **durable product semantics** (what users see during a stop, how idempotency works, what we audit, how multi-agent stops aggregate). The stub types in `agent-stop-command.ts` are a sketch, not a signed-off contract. Wrong choices here are expensive to unwind (migrations, UI projections, daemon redrive logic).

**What exists today (Stage 1 stub):**

```text
requestAgentStop
  → patch desiredState: stopped
  → enqueue agent.requestStop { chatroomId, role, reason, pid }
  → (no durable command row; inbox row deleted after ack)
```

Stub helpers already chosen in Slice 1:

- `targetKey` = `machineId:normalizedRole:pid`
- `revisionKey` = `stopCommandId:targetKey`
- `scope` = `{ kind: 'chatroom' }` | `{ kind: 'agent', role }`
- `status` = `pending | processing | completed | failed`

**Decisions you need to make:**

#### 1. Table model (recommended default: 3-table)

| Option                                                             | Pros                                                                               | Cons                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| **A. Single table** — one row per stop request, JSON targets array | Simple writes                                                                      | Hard to query per-machine progress; awkward redrive |
| **B. Command + targets** — command row + N target rows             | Clear per-PID tracking                                                             | Still need machine fan-out for inbox                |
| **C. Command + machine execution + targets (recommended)**         | Matches inbox fan-out; supports redrive per machine; UI can aggregate at any level | More schema + projection code                       |

**Recommendation:** Option C — aligns with how the system already fans out (`machineId` inbox, per-role PID).

Proposed tables (names illustrative):

```text
chatroom_agentStopCommands
  _id (stopCommandId)
  chatroomId, scope, reason, requestedBy, status, createdAt, completedAt?

chatroom_agentStopMachineExecutions
  stopCommandId, machineId, inboxCommandId?, status, claimedAt?, completedAt?

chatroom_agentStopTargets
  stopCommandId, machineId, role, pid, targetKey, revisionKey, status, outcome?, error?
```

#### 2. Scope semantics

| Stop source                           | Proposed scope                                             | Fan-out                                                           |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| User stops one role (`AgentControls`) | `{ kind: 'agent', role }`                                  | 1 target (known machine from config)                              |
| Stop all (`ChatroomDashboard`)        | `{ kind: 'chatroom' }`                                     | N targets (all running roles)                                     |
| Team switch / dedup (backend)         | per-role or chatroom depending on producer                 | already known at enqueue time                                     |
| Daemon shutdown                       | `{ kind: 'chatroom' }` per machine? or machine-local scope | **needs your call** — affects whether one command spans chatrooms |

**Question for you:** Should `chatroom` scope mean "all agents in this chatroom across all bound machines" (likely yes), and should daemon shutdown create one command per chatroom or one per machine?

#### 3. Reason enum SSOT

Runtime today uses `agent.ts` `AGENT_STOP_REASONS` (`platform.dedup`, `platform.team_switch`, …). Stub uses shorter names (`dedup`, `team.switch`). Stage 2 should **adopt `agent.ts` literals** on the command aggregate and delete the stub enum — unless you want a separate audit-facing vocabulary.

#### 4. UI projection contract

What should `stopState` expose per role?

```ts
// Example — confirm fields you want
type AgentStopState =
  | { phase: 'idle' }
  | { phase: 'requested'; stopCommandId: string }
  | { phase: 'stopping'; stopCommandId: string }
  | { phase: 'stopped'; stopCommandId: string }
  | { phase: 'failed'; stopCommandId: string; error: string };
```

**Question for you:** Should the UI show in-progress stop at the chatroom level (e.g. sidebar spinner) or only per-role in the agent panel?

#### 5. Retention & idempotency

- How long do completed/failed commands live? (affects table size and "stop again" behavior)
- If user clicks stop twice while first command is `processing`, coalesce to same command or create a new one?

**Recommendation:** Coalesce while `pending|processing` for same `(chatroomId, scope)`; new command after `completed|failed`.

---

**What you can decide now vs later:**

| Must decide before Slice A             | Can defer to Slice B/C   |
| -------------------------------------- | ------------------------ |
| Table model (A/B/C)                    | Exact retention TTL      |
| Scope rules for user stop vs shutdown  | Error message copy in UI |
| Reason enum SSOT                       | Redrive cron interval    |
| Coalesce vs new command on double-stop |                          |

-->

## Verification log

- Slice 1: `pnpm --dir packages/cli exec vitest run src/daemon/domain/usecase/stop-agent-confirmed.test.ts src/daemon/domain/usecase/stop-agent-scope.test.ts` (10 passed); `pnpm --dir packages/cli typecheck` (passed).
- Slice 2: `pnpm --dir packages/cli exec vitest run src/daemon/infrastructure/agent-process-manager/agent-process-manager.test.ts` (103 passed); `pnpm --dir packages/cli typecheck` (passed).
- Slice 3: scoped inbox stop wiring implemented; verification pending (see Pre-Stage 2).
- Slice B: durable command creation, coalescing, target/execution fan-out, and `agent.stopScope` payload landed; daemon report mutations remain for follow-up.
- Slice B backend tests: create-agent-stop-command, rollup, stop-agent agent.stopScope (10 passed).
- Slice B final: `pnpm --dir packages/cli typecheck`, `pnpm --dir services/backend typecheck`, and scoped handler tests passed.
- Slice 4: `pnpm --dir services/backend exec vitest run src/domain/usecase/agent/stop-agent.spec.ts src/domain/usecase/agent/ensure-only-agent-for-role.spec.ts tests/integration/stop-agent.spec.ts tests/integration/send-command-stop-reason.spec.ts` (16 passed).
- Slice 5: `pnpm --dir apps/webapp exec vitest run src/modules/chatroom/components/ChatroomSidebar.test.tsx` (15 passed).
- Slice 6: legacy daemon stop handler removed; UI zero `sendCommand` stop-agent producers; handler tests passed.
- Slice C verification: `pnpm --dir services/backend exec vitest run src/domain/usecase/agent/derive-agent-operational-state.spec.ts tests/integration/project-agent-lifecycle-fact.spec.ts src/domain/usecase/agent/stop-agent.spec.ts` (24 passed); backend and CLI typechecks passed.
- Slice D verification: backend typecheck, webapp typecheck, and stop-state unit tests passed.
- Slice E verification: backend, CLI, and webapp typechecks passed; harness routing and requestScope shutdown foundation landed.
- Tech-debt cleanup (2026-08-25): commits `f79ccca8c`, `896a18a0e`, `1cca0ac69`, `74bc3950f` on `fix/stop-command-daemon-lifecycle`.
- Tech-debt verification: backend 5 files 40 passed; CLI 3 files 9 passed (stop-agent, start-agent, send-command-stop-reason, get-agent-view-status, project-agent-lifecycle-fact; on-request-stop-agent, stop-agent-scope-adapter, stop-agent-confirmed).
