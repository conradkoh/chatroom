# Native SDK task delivery simplification and observability plan

Scope: native SDK harnesses only. Legacy CLI harness delivery is explicitly out of scope.

## Goal

Make the delivery contract easy to follow:

```text
frontend message
  → backend task or queued message
  → backend queue promotion
  → assigned-task snapshot and task-status signal
  → daemon task inbox
  → native agent readiness
  → prompt injection
  → task activity / turn lifecycle
```

The daemon must distinguish clearly between a task that is visible, a task that is
blocked, and a task whose injection is actually in flight or complete.

## Phase 1 — Document the current contract

- [ ] Document the backend state transitions for native delivery:
  - [ ] direct user message → `chatroom_tasks.pending` when no active task exists;
  - [ ] user message → `chatroom_messageQueue` when any `pending`, `acknowledged`, or
        `in_progress` task exists;
  - [ ] queued message → pending task only after backend promotion sees no active task;
  - [ ] injection → `pending` to `acknowledged` through `claimTask`;
  - [ ] activity/receipt handling → `acknowledged` to `in_progress`.
- [ ] Document that the daemon consumes machine task-status signals and assigned-task
      snapshots rather than subscribing directly to `chatroom_tasks`.
- [ ] Document the intended trigger policy:
  - [ ] task signal updates the local task snapshot;
  - [ ] agent start attempts delivery for newly available cold-start work;
  - [ ] native turn completion is the primary steady-state delivery trigger;
  - [ ] periodic reconciliation is a watchdog, not the normal success path.
- [ ] Document the distinction between backend queue promotion and daemon prompt delivery.

## Phase 2 — Separate delivery responsibilities

- [ ] Refactor native delivery into three explicit responsibilities:
  - [ ] `selectNextTask`: filter restart-in-flight tasks, order by queue position/creation
        time, and select the first candidate for a role;
  - [ ] `explainDeliveryReadiness`: return a structured ready/blocked result;
  - [ ] `deliverTask`: hydrate, claim, record receipt, build the prompt, and resume the
        native harness.
- [ ] Preserve one-task-at-a-time delivery per chatroom + role.
- [ ] Keep the delivery mutex around the actual injection operation only.
- [ ] Ensure every exit from candidate evaluation has an explicit outcome, including:
  - [ ] no candidate;
  - [ ] task status not deliverable;
  - [ ] wrong acknowledged role;
  - [ ] agent not ready;
  - [ ] task already locally active;
  - [ ] delivery mutex busy;
  - [ ] task hydration missing;
  - [ ] injection succeeded;
  - [ ] injection failed.

## Phase 3 — Unify native readiness policy

- [ ] Make agent activation and task injection share the same native readiness policy.
- [ ] Centralize checks for:
  - [ ] native SDK harness;
  - [ ] operational desired state is `running`;
  - [ ] no chatroom stop scope, operational stop intent, or open circuit;
  - [ ] local slot state (`idle`, `spawning`, `running`, `stopping`);
  - [ ] PID and real harness session ID;
  - [ ] `nativeTurnPhase === 'idle'`;
  - [ ] explicit cold-session policy.
- [ ] Keep cold-session-specific rules separate from ordinary continue-session rules, but
      make both return the same structured readiness result.
- [ ] Remove duplicated partial gating from `startPendingNativeAgents` where it can use
      the shared policy safely.
- [ ] Add focused tests for every readiness blocker and for the ready path.

## Phase 4 — Simplify delivery triggers

- [ ] Make post-turn delivery the primary steady-state path:
  - [ ] native `agent_end` schedules delivery after the process-manager serialization
        boundary releases;
  - [ ] the native turn phase is idle before readiness is evaluated;
  - [ ] the next eligible task is attempted once.
- [ ] Retain task inbox signals as the authoritative way to discover/update tasks.
- [ ] Retain agent-start delivery for pending tasks that require starting a native agent.
- [ ] Reevaluate operational-status delivery so it triggers only when readiness changes
      from blocked to eligible or when a required session becomes available.
- [ ] Keep periodic reconciliation as a watchdog that can recover missed events, but avoid
      treating every poll as a normal delivery attempt.
- [ ] Verify duplicate triggers cannot cause duplicate prompt injection.

## Phase 5 — Improve delivery logging

- [ ] Replace the generic `fallback ... — reconcile` message with explicit outcomes:
  - [ ] `candidate`;
  - [ ] `blocked`;
  - [ ] `mutex_busy`;
  - [ ] `inject_start`;
  - [ ] `inject_success`;
  - [ ] `inject_failure`;
  - [ ] `candidate_removed`.
- [ ] Always log blocked candidates, including non-deliverable statuses such as
      `in_progress`. Do not condition block logging on deliverability.
- [ ] Include these fields in candidate/blocked/injection logs:
  - [ ] delivery pass/source;
  - [ ] chatroom ID and role;
  - [ ] task ID;
  - [ ] task status and task `updatedAt`;
  - [ ] assigned role;
  - [ ] slot state and PID;
  - [ ] harness session presence/ID, redacted if necessary;
  - [ ] native turn phase;
  - [ ] operational state;
  - [ ] local active task ID;
  - [ ] block reason.
- [ ] Add a delivery-attempt ID so candidate, hydration, injection, success, and failure
      logs can be correlated.
- [ ] Log backend task promotion with queued-message ID, new task ID, chatroom, and
      promotion result/reason.
- [ ] Log task-signal receipt and snapshot hydration failures with cursor information.

## Phase 6 — Reduce log volume without losing diagnosis

- [ ] Do not emit an identical periodic blocked line on every watchdog pass.
- [ ] Emit the first blocked reason and subsequent logs only when the reason changes.
- [ ] Emit a blocked-duration summary after a configurable interval, including elapsed
      time and attempt count.
- [ ] Always log transitions from blocked → ready and ready → injection.
- [ ] Keep injection failures and backend promotion failures at warning/error level.
- [ ] Keep routine successful reconciliation at debug level or omit it when no state changes.

## Phase 7 — Fix startup snapshot recovery

- [ ] Implement `syncMachineAssignedTaskSnapshotsMutation`; it currently validates access
      but does not rebuild the assigned-task projection.
- [ ] Define whether startup should rebuild all active snapshots for the machine or repair
      only missing/stale rows.
- [ ] Verify bootstrap ordering between:
  - [ ] snapshot synchronization;
  - [ ] snapshot loading;
  - [ ] room watcher creation;
  - [ ] task-signal cursor initialization.
- [ ] Add a restart test proving that an active pending task created before daemon startup
      is discovered and delivered.
- [ ] Add a test proving that a missing snapshot is repaired rather than silently skipped.

## Phase 8 — Test the end-to-end native contract

- [ ] Add/extend integration coverage for:
  - [ ] direct frontend message creates a pending task;
  - [ ] message during an active task enters the backend queue;
  - [ ] terminal task transition promotes the oldest queued message;
  - [ ] promotion creates the task snapshot and task-status signal;
  - [ ] daemon receives the signal and hydrates the task;
  - [ ] agent-end event injects the next task once the turn is idle;
  - [ ] pending native work starts an agent when needed;
  - [ ] task remains blocked while the turn is in flight;
  - [ ] task remains blocked while the slot is spawning/stopping;
  - [ ] task is not reinjected while locally active;
  - [ ] delivery failure releases the mutex and is retried by reconciliation;
  - [ ] stale/missing snapshots are repaired on bootstrap.
- [ ] Assert structured delivery outcomes, not only console strings.
- [ ] Run native delivery tests, daemon runtime tests, backend task FSM tests, typecheck,
      lint, and formatting.

## Validation checklist

The implementation is complete only when both the repository structure and the runtime
behavior satisfy the following checklist. A passing typecheck or unit-test suite alone is
not sufficient.

### A. Folder and ownership structure

- [ ] Frontend message submission remains owned by
      `apps/webapp/src/modules/chatroom/components/MessageInput.tsx` and uses the
      session-aware backend mutation.
- [ ] Backend message routing and queue decisions remain under
      `services/backend/src/domain/usecase/chatroom/` and `services/backend/convex/messages.ts`.
- [ ] Backend task creation, state transitions, and queue promotion remain under
      `services/backend/src/domain/usecase/task/`; no daemon code creates or promotes
      backend tasks.
- [ ] Backend machine snapshot projection and task-status signal writes remain under
      `services/backend/src/domain/usecase/machine/` and are invoked from the backend
      task write path.
- [ ] Daemon task-signal cursoring and snapshot caching remain under
      `packages/cli/src/daemon/infrastructure/inbox/`.
- [ ] Native delivery policy, selection, coordination, and injection remain grouped under
      `packages/cli/src/daemon/entry/native-delivery/`.
- [ ] Native readiness policy has one obvious owner; activation code does not duplicate a
      second, incompatible set of readiness rules.
- [ ] Process lifecycle ownership remains under
      `packages/cli/src/daemon/infrastructure/agent-process-manager/`; native delivery
      invokes lifecycle capabilities but does not manipulate process state directly.
- [ ] Logging helpers and delivery outcome types are colocated with native delivery and
      are not scattered across harness adapters or unrelated daemon modules.
- [ ] Legacy CLI harness delivery is not reintroduced into the native SDK implementation
      or its validation criteria.

### B. Backend lifecycle behavior

- [ ] A direct user message with no active task creates exactly one
      `chatroom_tasks` row with status `pending`.
- [ ] A user message while any `pending`, `acknowledged`, or `in_progress` task exists
      creates exactly one `chatroom_messageQueue` row and no task yet.
- [ ] A terminal transition promotes at most one oldest queued message for the chatroom.
- [ ] Promotion creates exactly one message and one pending task, links them, removes the
      queue row, and emits the assigned-task projection plus task-status signal.
- [ ] Queue promotion is observable separately from daemon delivery.
- [ ] No backend path promotes a queued message merely because the daemon is polling.
- [ ] A task status transition updates the machine snapshot before the corresponding
      task-status signal can cause daemon hydration to observe a missing row.
- [ ] Startup synchronization actually repairs or rebuilds missing/stale machine task
      snapshots; an access-check-only no-op is not acceptable.

### C. Daemon inbox and native delivery behavior

- [ ] The daemon receives task-status signals through the per-machine/per-chatroom cursor.
- [ ] Signal handling updates the local snapshot before attempting delivery.
- [ ] Bootstrap loads active snapshots and establishes cursors without losing tasks created
      during startup.
- [ ] Candidate selection, readiness explanation, and delivery execution are separate
      observable operations.
- [ ] Every candidate has exactly one explicit decision: no candidate, blocked, mutex busy,
      inject start, inject success, inject failure, or removed.
- [ ] A task with status `in_progress` cannot be injected as a new task.
- [ ] A `pending` or correctly assigned `acknowledged` task can be injected when the native
      slot is running, has a real session, and is idle.
- [ ] `turn_in_flight`, `injecting`, `slot_spawning`, and `slot_stopping` each produce a
      specific blocked reason and do not start a competing injection.
- [ ] Local active-task state and the delivery mutex prevent duplicate injection from
      simultaneous signal, operational, agent-end, and watchdog triggers.
- [ ] Native `agent_end` is the primary steady-state trigger for delivering the next task
      after a completed turn.
- [ ] Agent-start handling is limited to starting/delivering work that genuinely needs a
      native session.
- [ ] Periodic reconciliation is a watchdog for missed events, not the normal delivery
      mechanism.

### D. Logging and observability behavior

- [ ] The generic message `[NativeDelivery:fallback] ... — reconcile` is no longer emitted
      for every ordinary task-snapshot processing pass.
- [ ] Delivery logs distinguish trigger source from recovery/fallback status. For example,
      `inbox-signal`, `agent-end`, and `agent-started` are normal trigger sources, while
      `periodic-reconcile` is explicitly marked as watchdog/recovery.
- [ ] Every blocked candidate logs task ID, role, chatroom, task status, task update time,
      slot state, PID, session presence, native turn phase, operational state, local active
      task, trigger source, and block reason.
- [ ] Non-deliverable statuses, especially `in_progress`, are logged rather than silently
      ignored.
- [ ] Backend queue promotion logs queued-message ID, task ID, chatroom, and promotion
      result/reason.
- [ ] Signal receipt, cursor advancement, snapshot hydration, mutex acquisition, mutex
      release, injection start, injection success, and injection failure are correlatable
      with one delivery-attempt ID.
- [ ] Repeated identical blocked states are rate-limited or summarized with duration and
      attempt count.
- [ ] Logs make it possible to determine whether a task is blocked before injection,
      blocked by lifecycle state, blocked by backend state, or failed during injection.

### E. Fallback-path acceptance criteria

For a basic native SDK flow—one user message, an already running idle agent, no restart,
no stop intent, no circuit error, and no intentionally dropped signal—the following must
hold:

- [ ] The task is delivered through the normal task-signal/agent-idle path.
- [ ] There is exactly one injection attempt for the task.
- [ ] There are zero `periodic-reconcile`-initiated injection attempts.
- [ ] There are zero repeated periodic-reconcile logs for the same unchanged task state.
- [ ] The watchdog may run, but it must produce no delivery log when the task has already
      been delivered or when there is no state change.
- [ ] The normal-flow test fails if any generic fallback/reconcile event is emitted more
      than once for the task, or if the watchdog becomes the source of delivery.

For a message arriving while the native agent is mid-turn:

- [ ] The task signal records the candidate without attempting injection while
      `nativeTurnPhase !== 'idle'`.
- [ ] Exactly one post-`agent_end` delivery attempt occurs after the phase becomes idle.
- [ ] The periodic watchdog contributes zero injection attempts.

For a deliberately degraded flow where the task signal or turn-end event is missed:

- [ ] Periodic reconciliation eventually performs one recovery injection.
- [ ] The logs explicitly identify the recovery as watchdog/fallback behavior.
- [ ] The recovery path is covered by a dedicated test and is not used as the expected
      path in basic-flow tests.

### F. Test and verification gates

- [ ] Unit tests cover task selection, each readiness blocker, structured outcomes, and
      log de-duplication/rate limiting.
- [ ] Integration tests cover direct message delivery, queued-message promotion, task
      signals, agent-end delivery, startup recovery, duplicate triggers, and watchdog
      recovery.
- [ ] Tests assert structured delivery outcomes and fallback counts, not only substring
      matches against console output.
- [ ] Native SDK tests do not rely on CLI harness behavior.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint:fix` produces no unintended changes.
- [ ] `pnpm format:fix` produces no unintended changes.
- [ ] A captured basic-flow log demonstrates zero periodic-reconcile delivery attempts and
      no repeated generic fallback output.

## Completion criteria

- [ ] The folder structure makes ownership of frontend submission, backend promotion,
      daemon inboxing, native readiness, lifecycle control, and observability obvious.
- [ ] Every reconciliation candidate has an observable decision.
- [ ] A task blocked for 20 minutes can be diagnosed from logs without inspecting source.
- [ ] Agent activation and injection use one consistent readiness policy.
- [ ] Basic native SDK flows do not depend on periodic reconciliation and do not emit
      repeated fallback logs.
- [ ] Periodic reconciliation remains a tested, bounded recovery mechanism only.
- [ ] Backend queue promotion and daemon injection are separately observable.
- [ ] Daemon startup repairs or reconstructs the task snapshot projection reliably.
