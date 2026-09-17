# Move task lifecycle ownership from Convex to the daemon

> **Status:** drafted, awaiting owner-dictated implementation sequence. No phase
> ordering is prescribed; every row is independently verifiable and may be
> scheduled in any order that satisfies its stated dependencies.

## Objective

The daemon becomes the owner of native task lifecycle state — claim
(acknowledge), start (in-progress), failure, requeue/release, and attempt
bookkeeping. Convex stops inferring task transitions from lifecycle facts and
message flows. Convex retains exactly two task responsibilities:

1. **Ingress** — task creation and queueing from user messages and handoffs
   (must work while the owning machine's daemon is offline).
2. **Projection** — one daemon→Convex write path the webapp reads for task
   status. No business rules on that path.

## Motivation (evidence)

**Incident 2026-09-16**, chatroom `jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2`, task
`md7dshwq9retby00fees8m1jy58eh2np` (details in `/report.md`):

- The task was injected **11 times in ~7.5 minutes**. Backend inbox events show
  the task flip-flopping `acknowledged → pending` within ~1s of every injection.
- Root cause: the daemon injector claims the task via a **direct Convex
  mutation** (`tasks.claimTask`) _before_ the cold-restart stop; the stopped
  agent's `exited` lifecycle fact arrives via the **outbox** and releases the
  just-claimed task **role-wide** (`releaseTasksOnAgentExit` has no
  pid/session scope). Two unordered write paths raced on one row; the backend
  made a recovery decision with less information than the daemon had (it did
  not know the exit was a planned cold restart).
- Secondary: turn-ended reconcile redelivers a `pending` task with no attempt
  cap — the spawn-token rate limiter was the only brake (`1/5 remaining`).

Today four mutually unordered paths write task status in Convex: (1) direct
daemon mutations, (2) outbox-projected lifecycle facts, (3) message-flow rules
(token-activity resume, handoff Step-1 completion), (4) cleanup/crons/enhancer.
A component with no consistent view cannot own recovery semantics. Consolidating
lifecycle ownership in the daemon removes this failure class instead of
patching instances of it.

**Current daemon limitation:** both the task mirror (`TaskInboxState`) and the
dedup marker (`agentTaskState`) are in-memory `Map`s. Additionally, CLI commands
(e.g. `chatroom handoff`, run inside the agent's shell) call Convex directly,
bypassing the daemon entirely — see V17–V21 for the CLI gateway service that
closes this gap. The backend's status
transitions are currently the only dedup/recovery guard that survives a daemon
restart. The durable store (item 3 below) must land _before_ the Convex guards
are deleted, or a daemon restart reproduces the "repeatedly injected" loop.

## Invariants to preserve

- Pending tasks reach the assigned role's daemon (task-created inbox feed stays
  as the daemon's input).
- Delivery remains at-least-once across daemon restarts, but repetition is
  bounded (attempt cap) and surfaced.
- Agent crash, session loss, or daemon restart never silently abandons an
  in-flight task: exactly one requeue-or-fail transition with attempt metadata.
- Completed, closed, reassigned, or deleted tasks are never injected.
- Handoff-to-user still completes the active task exactly once, and duplicate
  handoff messages stay deduplicated.
- Chat UI shows task status while the machine is online; last projection or
  `pending` while offline.
- Cold-session / `sessionPolicy: "new"` behavior is unchanged.
- Stop intent, circuit state, and chatroom-stop scope keep blocking delivery.

## Validation criteria

Each criterion is independently checkable. "Verify" names the concrete
method (test, debug command, or code-level check). A criterion is done only
when its verification passes on the branch.

### Ordering and duplicate prevention

| #   | Boundary                       | Criterion                                                                                                                                                                                                                                                                                    | Verify                                                                        | Done |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---- |
| V1  | daemon · task-service injector | For a `sessionPolicy: "new"` task, the local claim is written **after** the previous slot has stopped; stopping the old agent can never undo a claim it could not know about. Re-running the 2026-09-16 scenario shows one claim, zero `acknowledged→pending` flips.                         | injector unit test + incident-scenario replay in `agent-work-manager.test.ts` | ⬜   |
| V2  | daemon · task-service decision | Turn-ended redelivery of the same `(chatroomId, role, taskId)` with no intervening status change is capped at N consecutive attempts; at the cap a delivery failure (`redelivery_exhausted`) is recorded and auto-redelivery stops. Any new inbox event or status change resets the counter. | coordinator/work-manager unit tests (cap, reset, other passes unaffected)     | ✅ `130d8805b` — N=3 consecutive uncovered turn ends (task-service-owned in-memory counter); cap → release skipped + single `redelivery_exhausted` failure + delivery-decision gate skips the task; resets = fresh task_assigned / completed / deleted inbox events + agent-started `user.start` (daemon-authored task_updated transitions deliberately do NOT reset); failed turns count too |
| V3  | daemon · task-service store    | Dedup marker and task mirror are durable (survive daemon restart). Restart with an in-flight task resumes the harness session when possible; otherwise requeues once with an attempt increment — never a tight loop.                                                                         | store persistence test + restart integration test                             | ⬜   |
| V4  | daemon · task-service          | At-least-once delivery across restarts is preserved (existing semantics from the self-sufficient plan), bounded by V2's cap.                                                                                                                                                                 | existing restart/reconcile tests still pass unmodified                        | ⬜   |

### Crash and recovery semantics (daemon-owned)

| #   | Boundary                                      | Criterion                                                                                                                                                                                                                                   | Verify                                                              | Done |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---- |
| V5  | daemon · agent-process-service + task-service | Process exit or session loss for a role with an in-flight task produces exactly one local transition (requeue or failed, with attempt metadata). The decision requires no backend round-trip and is visible in daemon debug state and logs. | work-manager integration test + `chatroom debug` inspection         | ⬜   |
| V6  | convex                                        | No backend code path mutates task status from an `exited` lifecycle fact. The fact remains audited for observability only.                                                                                                                  | code-level check: `on-agent-exited.ts` no longer calls task release | ⬜   |
| V7  | daemon                                        | A crash between slot-stop and claim leaves the task recoverable on the next reconcile (bootstrap / agent-started); recovery is at most one re-delivery, bounded by V2.                                                                      | fault-injection unit test                                           | ⬜   |

### Convex responsibilities retired

| #   | Boundary | Criterion                                                                                                                                                                                                                                        | Verify                                                                   | Done |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---- |
| V8  | convex   | Task status transitions in the backend originate only from (a) ingress (task creation) and (b) the daemon projection write path. No production backend usecase calls `transitionTask` outside those two boundaries.                              | grep-level check over `services/backend/src` + `services/backend/convex` | ⬜   |
| V9  | convex   | Token-activity resume rules (`start-task-from-token-activity.ts`) are deleted with no behavior change for native delivery (the injector claim covers adoption). The CLI `get-next-task` path decision is recorded (see open questions).          | deleted files + native e2e passing                                       | ⬜   |
| V10 | convex   | Handoff Step-1 completion is removed from `messages.ts`. Handoff completion is performed by the daemon task service with exactly-once semantics; duplicate handoff messages remain deduplicated (replacement for `terminalHandoffKey` behavior). | handoff e2e + daemon unit test                                           | ⬜   |
| V11 | convex   | Queue promotion on task completion is triggered by the daemon, preserving `queuePosition` ordering and the promote-next user-visible behavior.                                                                                                   | promotion unit test moved to daemon task service                         | ⬜   |

### Projection and ingress

| #   | Boundary        | Criterion                                                                                                                                                                                                     | Verify                                   | Done |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---- |
| V12 | convex + webapp | Webapp task status renders from one projection read model; while the machine is online the status reflects daemon state; offline shows the last projection or `pending`.                                      | webapp component tests + projection test | ⬜   |
| V13 | convex          | Message read-model task-link fields (`acknowledgedAt`, `completedAt`) are populated from projection writes, not independent backend logic.                                                                    | `message-read-model-task-link.spec.ts`   | ⬜   |
| V14 | convex + daemon | Task creation while the daemon is offline remains possible (ingress unchanged); the daemon adopts created tasks on bootstrap and claims them locally.                                                         | bootstrap adoption test                  | ⬜   |
| V15 | daemon          | Completed, closed, reassigned, or deleted tasks are never injected (carried over from the 2026-09-09 unification plan); deletes/tombstones arrive via inbox events and are honored against the durable store. | existing inbox-lifecycle tests           | ⬜   |

### Observability

| #   | Boundary | Criterion                                                                                                                                                                                                                                                                                             | Verify                                  | Done |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---- |
| V16 | daemon   | Every local transition emits a structured event (`task_attempt.started/activity/turn_completed/turn_failed/requeued/failed/completed` — the taxonomy proposed in `report.md`), and daemon debug state exposes task + attempt history. The 2026-09-16 incident is classifiable from daemon logs alone. | debug-state unit test + incident replay | ⬜   |

### CLI gateway service

| #   | Boundary                                     | Criterion                                                                                                                                                                                                                                                                | Verify                                                                       | Done                                                                                                                                                                                                          |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V17 | cli · handoff command + daemon · cli-gateway | The handoff command no longer calls the Convex backend directly: it routes every backend call through the new CLI gateway service hosted by the daemon. No production `backend.mutation(api.messages.handoff, ...)` call remains in `commands/handoff/index.ts`.         | code-level check + handoff command unit test asserting gateway routing (R11) | ✅ `0e4655619`, `1a443b695` — grep clean; routing test asserts gateway spy called and backend mutation NOT called (reviewer F3 fix, `8d4403b4b`)                                                              |
| V18 | cli-gateway → task-service                   | After the CLI gateway completes the backend handoff, it calls the task service to update its in-memory state (active task completed, next task adopted) so local state reflects what the backend recorded — before the CLI command returns success.                      | cli-gateway unit test (backend success → task-service update observed)       | ✅ `index.test.ts` asserts backend → load → task-service ordering and adopted-task payload; post-commit failures return success with best-effort cleanup (reviewer F1 fix, `8d4403b4b`)                       |
| V19 | daemon · cli-gateway                         | The CLI gateway service exposes a local port for CLI commands (same pattern as the existing local web port); the CLI discovers and connects to it. Behavior when the daemon is offline is explicit and defined (open question 8) — no silent direct-to-backend fallback. | port/service integration test + offline-behavior test                        | ✅ reuses daemon local-web port (18765) via `resolveLocalWebPort`; offline → explicit "CLI gateway unavailable" error, no silent fallback; real Socket.IO routing test on the daemon server (`8d4403b4b`, F4) |
| V20 | daemon · cli-gateway                         | The CLI gateway writes its own log stream on the daemon — an identifiable channel (e.g. `[CliGateway:...]`) recording each CLI request, the backend call, its outcome, and the task-service update.                                                                      | log-line assertions in gateway tests                                         | ✅ `[CliGateway:...]` channel asserted in tests; in-memory debug ring + stdout. Follow-up (acknowledged reviewer F5): persist via the daemon log repository                                                   |
| V21 | daemon · debug command                       | `chatroom debug` includes the CLI gateway service's logs (and its port/state) in the debug output, alongside the other daemon services.                                                                                                                                  | `chatroom debug` output test / manual inspection against the running daemon  | ✅ debug state includes `cliGateway` (port + logs); Socket.IO integration test asserts it (`8d4403b4b`, F4)                                                                                                   |

## 1. Things to remove

Code that exists to keep Convex authoritative. Each row is removed (✅) or not (⬜).

| #   | Boundary                              | File → Component                                                                                                                                    | Responsibility to remove                                                                                                                     | Done                      |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | convex · task recovery                | `src/domain/usecase/task/release-tasks-on-agent-exit.ts` → `releaseTasksOnAgentExit`, `shouldReleaseTasksOnAgentExit`                               | Role-wide task release on agent exit (recovery decision moves to the daemon, which owns process lifecycle and the restart plan)              | ◐ `shouldReleaseTasksOnAgentExit` removed; the exited-fact path no longer releases. `releaseTasksOnAgentExit` retained for the two explicit user-initiated callers (chatroom-stop enhancer interrupt, `request-agent-restart`) until they migrate; `reassignTasksOnTeamSwitch` retained (open question 2) |
| R2  | convex · task recovery                | `src/events/agent/on-agent-exited.ts` → `onAgentExited` task-release call (fact auditing stays)                                                     | Backend interpretation of `exited` facts as task-state transitions                                                                           | ✅ `onAgentExited` no longer releases tasks on exit facts (team-switch reassignment kept); recovery is daemon-owned — scoped `releaseTaskAfterTurnFailure` on turn failures plus an explicit shutdown release (`on-daemon-shutdown.ts`) |
| R3  | convex · task recovery                | `convex/tasks.ts` → `releaseTaskAfterTurnFailure` mutation + gateway port `claimPendingTask`-style call in `convex-native-task-delivery-gateway.ts` | Backend turn-failure release; daemon transitions locally instead                                                                             | ⬜                        |
| R4  | convex · task adoption                | `src/domain/usecase/participant/start-task-from-token-activity.ts` → token-activity rules                                                           | Ack/resume heuristics compensating for agents that never claimed (injector claim replaces)                                                   | ⬜                        |
| R5  | convex · task FSM                     | `convex/lib/taskStateMachine.ts` + `src/domain/usecase/task/transition-task.ts`                                                                     | Backend FSM validation/guards for daemon-owned lifecycle transitions; becomes ingress creation + projection writes only                      | ⬜                        |
| R6  | convex · handoff completion           | `convex/messages.ts` → handoff Step-1 (`collectActiveTasks` / `completeTasks`, legacy #798 pending force-complete)                                  | Backend completing tasks as a side effect of message flow                                                                                    | ⬜                        |
| R7  | convex · queue promotion              | `src/domain/usecase/task/maybe-promote-next-queued-task.ts` trigger from `transitionTask`                                                           | Promotion as an implicit backend side effect; daemon triggers it on completion                                                               | ⬜                        |
| R8  | convex · claim                        | `convex/tasks.ts` → `claimTask` mutation (+ `acknowledge-pending-task.ts` usecase)                                                                  | Backend-side claim for native delivery (daemon claims locally); keep only if the CLI `get-next-task` legacy path is retained (open question) | ⬜                        |
| R9  | daemon · task-service service surface | `agent-work-manager.ts` → `releaseTaskAfterTurnFailure` wiring in `deliveryTaskService`                                                             | Daemon dependency on the backend release mutation (replaced by local transition)                                                             | ⬜                        |
| R10 | daemon · task-service state           | `infrastructure/inbox/task-inbox-state.ts` (in-memory `Map`) + `agentTaskState` marker                                                              | In-memory-only task mirror and dedup marker; replaced by the durable store                                                                   | ⬜                        |
| R11 | cli · handoff command                 | `commands/handoff/index.ts` → direct `backend.mutation(api.messages.handoff, ...)`                                                                  | Direct CLI→Convex backend call; all backend access routes through the CLI gateway service (V17)                                              | ✅ removed in `0e4655619` |

## 2. Responsibilities to deprecate from Convex

Behaviors, not files; verifiable the same way.

| #   | Boundary                           | Behavior to deprecate                                                                                                                  | Replaced by (daemon)                                        | Done |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---- |
| D1  | convex · task FSM                  | Owning/validating task status transitions (FSM guards) for daemon-delivered tasks                                                      | task-service local transitions + projection                 | ⬜   |
| D2  | convex · recovery semantics        | Deciding recovery from lifecycle facts (exit release, turn-failure release) with coarser scope (role-wide) than the daemon's knowledge | agent-process-service emits facts; task-service decides     | ⬜   |
| D3  | convex · token heuristics          | Inferring task adoption/resume from participant token activity and delivery receipts                                                   | injector claims at confirmed delivery                       | ⬜   |
| D4  | convex · message-flow side effects | Completing tasks inside the handoff message mutation (Step-1) and the pending force-complete branch                                    | daemon interprets the handoff and completes the active task | ⬜   |
| D5  | convex · queue side effects        | Auto-promoting the next queued task inside task completion                                                                             | daemon task service promotes after completion               | ⬜   |
| D6  | convex · attempt bookkeeping       | Recovery-grace / attempt bookkeeping scattered across release paths (`RECOVERY_GRACE_PERIOD_MS`)                                       | attempt metadata on the daemon's durable store              | ⬜   |

## 3. Responsibilities to add to the daemon (per service)

| #   | Daemon service                                                                                   | Responsibility to add                                                                                                                                                                                                                                                                                                        | Done                                       |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| A1  | task-service · **durable task store** (new)                                                      | Sqlite-backed store (alongside `~/.chatroom/daemon/<machine>/` outboxes) owning lifecycle state: `pending/acknowledged/in_progress/completed/failed`, `assignedTo`, attempts, attempt metadata, machine scoping. Single source of truth for the daemon.                                                                      | ⬜                                         |
| A2  | task-service · delivery decision (`delivery-decision.ts`, `native-task-delivery-coordinator.ts`) | Decision reads the local store only (no backend status round-trip for dedup); turn-ended redelivery attempt cap (V2).                                                                                                                                                                                                        | ⬜                                         |
| A3  | task-service · injector (`native-task-injector.ts`)                                              | Local claim after cold-restart stop/start (V1); attempt recording; keep cold-session semantics unchanged.                                                                                                                                                                                                                    | ⬜                                         |
| A4  | task-service · **projection writer** (new)                                                       | Single daemon→Convex write path for user-visible task status + message read-model link fields (V12, V13); replaces the four unordered write paths.                                                                                                                                                                           | ⬜                                         |
| A5  | agent-process-service · `agent-work-manager.ts`                                                  | On process exit / session lost: notify task-service for the local requeue/fail transition (replaces R1–R3). Emit a structured turn-outcome fact (taskId, completionStatus, harnessSessionId, turnId) for V16.                                                                                                                | ⬜                                         |
| A6  | agent-process-service · `agent-process-manager.ts`                                               | Enrich `exited` facts with pid/session scope for auditing only (no task decisions); keep slot/turn-phase state as process-service interior state.                                                                                                                                                                            | ⬜                                         |
| A7  | task-service · bootstrap/`task-inbox-runtime.ts`                                                 | Rehydrate owned tasks from the durable store on boot; subscribe to `task_created` inbox events for adoption (V14); continue honoring tombstones/deletes (V15).                                                                                                                                                               | ⬜                                         |
| A8  | task-service · debug state (`task-service-debug-state.ts`, local web)                            | Expose task lifecycle + attempt history for `chatroom debug` / daemon logs (V16).                                                                                                                                                                                                                                            | ⬜                                         |
| A9  | **cli-gateway service** (new)                                                                    | Daemon-hosted gateway with a local port (`V19`): proxies CLI commands to the Convex backend (starting with handoff, `V17`/`R11`), forwards task-relevant outcomes to the task service in-memory state (`V18`, interplay with `A1` noted), and writes its own daemon log stream (`V20`) surfaced in `chatroom debug` (`V21`). | ✅ `0e4655619` + `1a443b695` + `8d4403b4b` |

## 4. Call paths to migrate

Current path → target path. Each row maps to the validation criteria it must satisfy.

| #   | Current call path                                                                                                                                                          | Target path                                                                                                                                                                                                                                 | Criteria                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| M1  | `runNativeInjectionEffect` → `claimTaskForDelivery` → backend `tasks.claimTask` (direct mutation, before cold restart)                                                     | injector → local `TaskService.claim` (after stop/start) → projection writer → Convex read model                                                                                                                                             | V1, V8                                                                              |
| M2  | `handleAgentTurnEnded` (failed) → `taskService.releaseTaskAfterTurnFailure` → backend `releaseTaskAfterTurnFailure` mutation → FSM `acknowledged/in_progress → pending`    | `handleAgentTurnEnded` → local task-service transition (requeue or failed + attempt metadata) → projection                                                                                                                                  | V5, V8                                                                              |
| M3  | `exited` fact → `projectAgentLifecycleFact` → `onAgentExited` → `releaseTasksOnAgentExit` (role-wide release)                                                              | deleted; process-exit/session-lost subscription in `agent-work-manager` → local transition → projection; fact kept for audit only                                                                                                           | V6, V5                                                                              |
| M4  | token activity → `apply-agent-activity-heartbeat` → `startTaskFromTokenActivity` (rules: `ruleReceiptNotStarted`, `ruleRecoveredPending`, `maybeStartAcknowledgedTask...`) | deleted; adoption + start handled by injector claim and daemon store                                                                                                                                                                        | V9                                                                                  |
| M5  | `chatroom handoff` CLI → direct `messages.handoff` mutation → Step-1 `collectActiveTasks`/`completeTasks` + `terminalHandoffKey` dedup → creates next task for target role | CLI handoff → CLI gateway service (local port, `V19`) → backend records handoff message → CLI gateway → daemon task service updates in-memory state (`V18`); Step-1 completion removal and inbox-feed adoption remain governed by `R6`/`D4` | V17 ✅, V18 ✅, V10 ⬜, V14 ⬜ — implemented in `0e4655619`/`1a443b695`/`8d4403b4b` |
| M6  | `transitionTask` → `maybePromoteNextQueuedTask` (backend side effect on completion)                                                                                        | daemon task service, after local completion, promotes the next queued task and delivers it                                                                                                                                                  | V11                                                                                 |
| M7  | four unordered task-status writers (daemon direct mutations; outbox facts; message-flow rules; cleanup/crons) → webapp reads ad-hoc queries                                | one projection write path (`A4`) → projection read model → webapp components (`WorkQueue`, `TaskDetailModal`, attachment chips)                                                                                                             | V12, V13                                                                            |
| M8  | daemon bootstrap rehydrates via backend `daemon.taskStatus.listActive` + inbox events for _all_ task state                                                                 | rehydrate owned/in-flight tasks from the durable store (`A1`, `A7`); consume `task_created` events only for adoption                                                                                                                        | V3, V14                                                                             |

## Open questions / owner decisions

1. **CLI / non-native roles** (`get-next-task` backend flow): migrate them onto the daemon task service too, or keep the backend claim path dual-mode during migration? (Determines whether R8 is deleted or kept.)
2. **`platform.team_switch` reassignment** (`reassignTasksOnTeamSwitch`): stays in Convex until the team workflow migrates, or moves with the rest?
3. ~~**Attempt cap value and policy** for V2 (N, reset semantics, and whether the cap applies to cold-restart redeliveries of the same task).~~ **RESOLVED** (`130d8805b`): N=3 consecutive uncovered turn ends per `(chatroomId, role, taskId)`; counter in-memory in the task service (restart re-bounds); applies to BOTH completed and failed turn-end paths, so cold-restart redeliveries of the same task are capped too. Resets: fresh `task_assigned` / completed / deleted inbox events and `agent-started` with reason `user.start` — daemon-authored `task_updated` transitions (release/claim) deliberately do NOT reset, since `transitionTask` emits events the daemon itself causes and no actor discriminator exists on the inbox event. User edits to a parked task additionally require an agent restart (`user.start`) to retry.
4. **Replacement for `RECOVERY_GRACE_PERIOD_MS`** semantics once attempt bookkeeping moves to the daemon store.
5. **Durable store schema + location** (`A1`): extend `~/.chatroom/daemon/<machine>/` sqlite pattern; retention of completed tasks.
6. **Enhancer / ephemeral agent interplay** (descoped in the 2026-11-19 plan): `requestEphemeralAgentRelease` and enhancer job completion read task status; confirm they consume the projection after migration.
7. **Prod cutover**: in-flight tasks and task history in prod Convex at the time guards are deleted; migration/backfill for in-flight rows.
8. **CLI gateway scope and offline behavior** (`V17`, `V19`): which other CLI commands route through the gateway over time (candidates: `get-next-task`, `task read`, `context`), and the defined behavior when the daemon is offline while an agent runs a CLI command (hard failure vs. retry guidance in the handoff output).

## Implementation status — CLI gateway task (first task of this plan)

Implemented on `plans/daemon-task-lifecycle-ownership` in three commits: `0e4655619` (gateway feature), `1a443b695` (gateway tests), `8d4403b4b` (review-fix hardening). Verified: `pnpm --filter chatroom-cli typecheck` 0 errors; full CLI suite 2435/2435 passing; `services/backend` diff empty.

**Owner decisions recorded during review (reviewer run `1927b289`, verdict BLOCK → resolved):**

- **Post-backend-commit semantics (escalated by reviewer, resolved):** a committed handoff NEVER reports retryable failure. Post-commit local-sync failures (adoption query, task-service update) are logged distinctly (`post-commit sync failure ...`) and the operation returns success with best-effort sender-task cleanup. Long-term option deferred: end-to-end idempotency for the handoff mutation if local reconciliation cannot be made reliable.
- **Error semantics (reviewer F2):** socket handler returns `{ ok:false, error:{message, code?, data?} }` in the ack instead of throwing; `ConvexError` code/message/details preserved through `normalize-error.ts` and a typed server-error transport (`local-daemon.ts`); only connection/transport failures are wrapped as "CLI gateway unavailable".
- **Offline behavior (open question 8, resolved interim):** hard failure with actionable message; no silent direct-to-backend fallback.

**Acknowledged follow-ups from the review (nits, not blocking):**

- F5: gateway logs persist via the daemon log repository (currently in-memory debug ring + stdout only).
- F6: move `HandoffGatewayOps`/handoff types to a neutral gateway contract module (daemon service currently imports command-layer types).

## Implementation status — exit-release removal (R1/R2, second task)

Backend no longer transitions task state from `agent.exited` facts. `onAgentExited` now only handles `platform.team_switch` reassignment (kept per open question 2); `shouldReleaseTasksOnAgentExit` deleted; `releaseTasksOnAgentExit` retained solely for the explicit user-initiated callers (chatroom-stop enhancer interrupt, `request-agent-restart`).

**Recovery matrix after removal (validated during implementation):**

| Exit scenario | Recovery | Status |
| --- | --- | --- |
| Agent crash/kill while daemon alive (`turn.failed`) | Daemon scoped `releaseTaskAfterTurnFailure` (R3, per-task) → pending → redeliver | unchanged ✅ |
| Planned cold restart (`platform.task_start_in_new_session`) | Restart redelivers the task itself; no exit release → the 2026-09-16 claim-destroy race is structurally gone (V1) | fixed ✅ |
| Graceful daemon shutdown (`daemon.shutdown`) | New daemon-owned release: `on-daemon-shutdown.ts` releases acknowledged/in_progress tasks via the scoped mutation before stopping agents (backend exit-fact release was the previous path) | compensated ✅ |
| Daemon crash / power loss | No exited facts emitted today either (the fact producer is the crashed daemon) — pre-existing gap, closed by plan A1/A5 (durable store + daemon-side requeue) | open, unchanged ⬜ |

Owner note: the shutdown release is a compensating change added during this task (not explicitly dictated) to avoid regressing graceful-shutdown recovery; veto or rehome it freely. Fallow pre-commit reports pre-existing clone groups + CRITICAL complexity in `cli-gateway-service` handoff — deferred tech debt (aligned with reviewer F6).

## Sqlite handoff repository (A1 first slice — validation criteria)

The daemon task service gains a durable, sqlite-backed handoff repository so
handoff state survives daemon restarts, and in-flight task recovery becomes a
deterministic daemon-owned rule keyed on that durable state — replacing the
removed Convex exit-release (R1/R2) for the daemon-crash row of the recovery
matrix above. Owner decisions (confirmed 2026-09-17): bootstrap sweep is in
scope this round; implemented via worker + reviewer delegation; a sqlite write
failure after a committed handoff logs a distinct failure and still returns
success (the backend commit is the source of truth).

### Repository

| #   | Boundary                     | Criterion                                                                                                                                                                                                                                        | Verify                                                     | Done |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---- |
| V22 | daemon · task-service        | A sqlite-backed handoff repository, owned by the task service, persists the latest handoff per `(chatroomId, role)`: handed-off task(s), adopted next task, target role, timestamp. File lives under the daemon sqlite pattern (`~/.chatroom/daemon/<machine>/`); schema is minimal and documented. | repository unit test (upsert/read semantics); no backend diff   | ✅ `5a21a6398` — sqlite PK `(chatroom_id, role)`, upsert, documented schema, `~/.chatroom/daemon/<machineId>/task-handoffs.sqlite`; repo upsert/read tests |
| V23 | daemon · restart persistence | The durable handoff record survives a daemon restart; after restart the bootstrap sweep can read the pre-restart handoff state.                                                                                                                                                 | restart integration test (write → new repository instance → read)| ✅ `5a21a6398` — restart test: close repo → fresh instance → read record |

### Durable write path (CLI gateway)

| #   | Boundary                     | Criterion                                                                                                                                                                                                                                        | Verify                                                     | Done |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---- |
| V24 | cli-gateway → task-service   | On a successful gateway handoff, the durable sqlite write completes BEFORE the CLI command returns success — the response is held until the write completes; ordering is backend commit → durable write → in-memory update → response.                 | gateway test asserting ordering (sqlite write awaited before result resolves) | ✅ `5a21a6398` + `53f428985` — ordering asserted with a DEFERRED durable-write promise (response unsettled while write pending); captured pre-commit taskIds asserted |
| V25 | cli-gateway                  | A sqlite write failure after a committed handoff logs a distinct failure line and still returns success (backend commit is the source of truth; no retryable failure reported for committed handoffs).                                                    | gateway test (sqlite write throws → success + distinct log)     | ✅ `53f428985` — sqlite-write rejection test: success returned + distinct `post-commit sync failure` logs |

### Release rule (replaces the removed Convex exit-release)

| #   | Boundary                     | Criterion                                                                                                                                                                                                                                        | Verify                                                     | Done |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---- |
| V26 | daemon · agent-work-manager  | On every agent turn end (completed or failed), if an active task exists whose latest durable handoff does not cover it, the daemon releases it via the scoped `releaseTaskAfterTurnFailure` path (→ pending → redelivered by reconcile). A handoff that covers the task produces no release; no active task produces nothing. | work-manager tests: turn-end no-handoff → released; handoff covers → no release; no active task → nothing | ✅ `5a21a6398` — coverage = latest record contains active taskId; uncovered → scoped release; covered → none; failed-turn path unchanged. Reviewer-verified: no double-release, no turn-end race window. Unbounded-loop accepted-risk now closed: V2 cap landed (`130d8805b`) — the merge-blocking condition is satisfied |
| V27 | daemon · bootstrap           | On daemon bootstrap, in_progress tasks whose latest durable handoff does not cover them are released via the same scoped path (closes the daemon-crash row of the recovery matrix — the last Convex exit-release replacement).                          | bootstrap sweep test (uncovered in_progress → released; covered → untouched) | ✅ `5a21a6398` + `53f428985` — sweep in `startTaskInbox` after rehydration; retriable: pending flag + bounded retries (3) + per-task isolation + distinct give-up log (reviewer F1 fix) |
| V28 | scope                        | No `services/backend` changes; the release rule reuses the existing scoped mutation; the CLI handoff backend mutation stays unchanged (R6 undictated).                                                                                                    | `git diff` scope check                                          | ✅ reviewer-verified: `services/backend` diff empty; all changed files under packages/cli; backend mutation unchanged |

## Implementation status — sqlite handoff repository (A1 first slice)

Implemented on `plans/daemon-task-lifecycle-ownership` in two commits: `5a21a6398` (repository, gateway durable write, turn-end release rule, bootstrap sweep) and `53f428985` (review-fix round: retriable sweep, non-vacuous durable-write tests, required repository dependency). Verified: CLI suite 2445/2445, CLI + backend typechecks clean, `services/backend` diff empty.

**Reviewer (run `fbb8d992`, verdict BLOCK → resolved):** release-semantics assessment clean — coverage check correct for handoff-then-next-task, multi-task, failed-vs-completed exclusivity; no practical turn-end/write race window; bootstrap race with a freshly delivered task not reachable in the current composition. F1 (one-shot sweep → retriable) and F2 (vacuous V24/V25 tests → deferred-promise + rejection tests) fixed in `53f428985`; F4 (required repository) applied.

**Owner decision (reviewer escalation, confirmed):** the completed-turn release rule can loop (release → redeliver → turn end without handoff) with no attempt cap. ACCEPTED for this explicitly intermediate A1 slice — the loop class is not new (turn-ended redelivery of acknowledged tasks already loops today), the practical brake is the spawn-token rate limiter, and **V2 (turn-ended redelivery attempt cap → record `redelivery_exhausted` → stop auto-redelivery until a status change/new inbox event) is MANDATORY before this branch merges.** It is the next candidate task. The daemon-crash row of the recovery matrix is now closed (bootstrap sweep releases uncovered in_progress tasks durably).
