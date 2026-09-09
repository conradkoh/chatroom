# Unify daemon task-delivery reconciliation

## Objective

Separate daemon task discovery, agent lifecycle, delivery decision-making, and
delivery execution into explicit responsibilities with one reconciliation
pipeline.

The current daemon has several partially overlapping paths that can all attempt
to recover a task:

- task-status inbox updates;
- agent operational-status updates;
- agent-started callbacks;
- agent turn-ended callbacks;
- restart-specific delivery;
- periodic reconciliation.

These paths share `processSnapshots`, but they do not share the same readiness
and activation behavior. Some paths start an agent, some filter on local slot
state before entering the coordinator, and some silently skip tasks before a
delivery decision is logged. This makes a live failure difficult to classify:
the daemon may have observed a task without attempting injection, or may have
attempted delivery while being blocked by a stale local slot/session state.

This plan introduces one role-scoped reconciliation pipeline. Every trigger
requests reconciliation for `(chatroomId, role)`; one coordinator reads the
current task, backend operational state, and local process/session state; one
pure decision function returns an explicit outcome; one executor performs the
required lifecycle or injection operation.

The migration must preserve these user-visible behaviors:

- pending tasks reach the configured role after agent start, restart, reconnect,
  turn completion, or daemon recovery;
- only the assigned role and machine can receive a task;
- native task delivery remains serialized per `(chatroomId, role)`;
- task content remains outside task-status signal payloads;
- completed, closed, reassigned, or deleted tasks are not injected;
- cold-session and new-session task policies remain intact;
- stop intent, circuit state, and chatroom stop scope continue to block delivery;
- daemon restart and reconnect recover current task and agent state;
- every blocked or failed recovery attempt has an actionable reason.

This plan is intentionally limited to daemon orchestration. The separate plans
for task-status signal storage and machine operational signal storage remain
responsible for those data-model migrations.

## Validation criteria

The change is valid only if all of the following are true:

1. **One delivery decision boundary**

   All task-delivery triggers must converge on one role-scoped reconciliation
   entry point. No trigger may independently implement a second readiness
   predicate, task filter, agent-start path, or native injection path.

   Validation:

   - [ ] Task inbox updates call role reconciliation.
   - [ ] Operational-status updates call role reconciliation.
   - [ ] Agent started and turn-ended events call role reconciliation.
   - [ ] Restart completion calls role reconciliation.
   - [ ] Periodic recovery calls role reconciliation only as a safety trigger.
   - [ ] There is one production implementation of the delivery decision.

2. **Explicit decision results**

   Delivery evaluation must return an explicit result rather than using an
   empty snapshot list or an early return as an implicit outcome.

   At minimum, the result must distinguish:

   - no deliverable task;
   - task blocked by task state or assignment;
   - agent start required;
   - agent/session not ready;
   - task injection required;
   - delivery already active or deduplicated;
   - execution failed.

   Validation:

   - [ ] Decision outcomes are represented by a typed discriminated union.
   - [ ] Each non-idle outcome has a stable reason code.
   - [ ] Logs include source, chatroom, role, task ID when known, and reason.
   - [ ] Tests cover every decision branch.

3. **Clear ownership boundaries**

   The task inbox owns task state, the process manager owns process state, the
   coordinator owns delivery decisions, and executors own side effects. No
   component may read another component's private state or duplicate its
   lifecycle logic.

   Validation:

   - [ ] Task inbox does not start agents or inject prompts.
   - [ ] Agent process manager does not inspect task queues.
   - [ ] Restart orchestration does not list/filter/deliver tasks.
   - [ ] Delivery decision code is pure or depends only on explicit state.
   - [ ] Delivery execution is serialized per role.

4. **Recovery is convergent**

   Any trigger that causes the coordinator to observe a deliverable task and a
   ready agent must eventually produce exactly one injection, even if the
   trigger is duplicated or arrives out of order.

   Validation:

   - [ ] Duplicate task and operational signals are harmless.
   - [ ] Restart followed by periodic reconciliation does not duplicate a task.
   - [ ] Agent session loss clears local active-task state.
   - [ ] A failed injection releases the per-role delivery lock and remains
         recoverable.
   - [ ] A stale local slot cannot permanently suppress pending work.

5. **Operational diagnosis is sufficient**

   A production incident must be classifiable from daemon logs without guessing
   which path ran.

   Validation:

   - [ ] Every reconciliation records its source.
   - [ ] Every blocked decision records a stable reason code.
   - [ ] Start and injection executions record success/failure.
   - [ ] Restart completion records the reconciliation result.
   - [ ] Swallowed errors are removed or converted into structured failure
         events.

These criteria are release gates. Exceptions must be documented before
implementation proceeds.

## Current state

```text
task signal ───────────────┐
operational signal ────────┤
agent started ─────────────┤
turn ended ────────────────┤
restart ───────────────────┤
periodic timer ────────────┘
          ↓
     processSnapshots()
          ├── startPendingNativeAgents()
          ├── restart-specific readiness filtering
          ├── coordinator readiness filtering
          └── native injection
```

Relevant current code:

- Task delivery processor:
  `packages/cli/src/daemon/entry/native-delivery/task-delivery-processor.ts`
- Native delivery service:
  `packages/cli/src/daemon/entry/native-delivery/native-delivery-service.ts`
- Native delivery coordinator:
  `packages/cli/src/daemon/entry/native-delivery/native-task-delivery-coordinator.ts`
- Restart orchestration:
  `packages/cli/src/daemon/entry/restart-orchestrator.ts`
- Restart command handler:
  `packages/cli/src/daemon/entry/events/agent/on-request-restart-agent.ts`
- Task service and local task state:
  `packages/cli/src/daemon/services/task-service/service/task-service.ts`
  and `packages/cli/src/daemon/infrastructure/inbox/task-snapshot-state.ts`
- Agent process manager:
  `packages/cli/src/daemon/services/agent-process-service/infrastructure/agent-process-manager.ts`
- Native readiness predicate:
  `packages/cli/src/daemon/services/task-service/domain/usecase/native-ready-invariant.ts`
- Native delivery predicate:
  `packages/cli/src/daemon/services/task-service/domain/usecase/native-task-injector-logic.ts`

The main ambiguity is that `processSnapshots('periodic-reconcile', ...)` logs
before readiness and active-task checks. Therefore a
`NativeDelivery:fallback` line proves only that a local snapshot was passed to
the processor; it does not prove that an injection was attempted.

The restart path has an additional ambiguity. `listDeliverableSnapshots` in
`restart-orchestrator.ts` filters tasks with
`isAgentReadyForNativeDelivery` before passing them to the delivery service.
A task filtered there cannot produce a normal delivery skip reason. The restart
use case also catches errors through the outer `restartAgent` boundary.

## Target architecture

```text
task inbox ────────────────┐
operational read model ────┤
agent lifecycle events ────┤
restart completion ────────┤
safety timer ──────────────┘
          ↓
requestReconcile(chatroomId, role, source)
          ↓
RoleDeliveryCoordinator
          ↓
read current role state:
  task snapshot(s)
  operational projection
  local process slot/session
  local active-delivery state
          ↓
DeliveryDecision (pure)
  ├── idle
  ├── blocked(reason)
  ├── start-agent(task)
  ├── wait(reason)
  ├── inject(task, session)
  └── deduplicated(reason)
          ↓
DeliveryExecutor
  ├── process manager: start/recover agent
  └── task service: inject task and record delivery
```

The coordinator is the only component that decides what should happen for a
role. The process manager remains the only component that starts or stops a
process. The task service remains the only component that injects task content.

Recommended interfaces:

```ts
type DeliveryTrigger =
  | 'task-signal'
  | 'operational-signal'
  | 'agent-started'
  | 'turn-ended'
  | 'restart-completed'
  | 'periodic-reconcile'
  | 'bootstrap';

type DeliveryDecision =
  | { kind: 'idle'; reason: 'no_deliverable_task' | 'not_assigned' }
  | { kind: 'blocked'; reason: DeliveryBlockReason; taskId?: string }
  | { kind: 'start-agent'; taskId: string }
  | { kind: 'wait'; reason: DeliveryWaitReason; taskId?: string }
  | { kind: 'inject'; taskId: string; harnessSessionId: string }
  | { kind: 'deduplicated'; taskId: string; reason: DeliveryDedupReason };

type ReconcileRequest = {
  chatroomId: string;
  role: string;
  source: DeliveryTrigger;
};
```

The exact names may change during implementation, but the separation between
trigger, decision, and execution is required.

## Migration sequence

### 1. Inventory current triggers and define the role state contract

- [ ] Enumerate every call to `processSnapshots`,
      `reconcileAssignedTasks`, `startPendingNativeAgents`, and
      `isAgentReadyForNativeDelivery` in production code.
- [ ] Document which component owns each input:
  - task snapshots and task status;
  - backend agent operational status;
  - local slot state;
  - native turn phase and harness session ID;
  - local active-task/delivery lock state.
- [ ] Define the canonical role key as `(chatroomId, normalizedRole)`.
- [ ] Define precedence when multiple active tasks exist for one role.
- [ ] Define the difference between:
  - blocked permanently until state changes;
  - waiting for an in-flight lifecycle operation;
  - start required;
  - ready to inject;
  - duplicate delivery suppressed.
- [ ] Define stable reason-code enums for current readiness failures, including:
  - task status not deliverable;
  - acknowledged task assigned to another role;
  - operational stop intent;
  - circuit open;
  - chatroom stop scope;
  - slot spawning/stopping/not running;
  - harness session missing;
  - native turn not idle;
  - task already active;
  - task hydration missing;
  - injection failure.
- [ ] Add a plan-level state transition diagram and use it as the contract for
      the implementation tests.

Acceptance gate:

- [ ] Every current trigger and readiness check has an identified owner.
- [ ] No implementation change has yet altered delivery behavior.

### 2. Extract a pure delivery decision function

- [ ] Create a focused domain module beside the existing native delivery use
      cases for role-scoped delivery decisions.
- [ ] Move task eligibility, operational stop/circuit checks, local slot
      readiness, active-task deduplication, and cold-session policy into one
      decision flow.
- [ ] Return `DeliveryDecision` rather than `boolean`, `null`, or an empty task
      list for blocked states.
- [ ] Keep the decision function free of Convex calls, process spawning,
      mutations, logging side effects, and timers.
- [ ] Pass all state as explicit input so tests can construct a complete role
      state without module-level registries.
- [ ] Preserve the existing semantics of `native-ready-invariant.ts` and
      `native-cold-session-delivery.ts`; move or wrap them incrementally rather
      than rewriting policy and orchestration at the same time.
- [ ] Add unit tests for every decision branch, including the incident shape:
      pending planner task, operational state running, and each local slot/session
      readiness failure.

Acceptance gate:

- [ ] The decision function is independently testable.
- [ ] Existing behavior is expressible through the decision results.
- [ ] No process or backend side effects occur inside the decision function.

### 3. Introduce one role-scoped reconciliation coordinator

- [ ] Add a `RoleDeliveryCoordinator` or equivalent constructed service with
      dependencies for:
  - task snapshot reader;
  - operational read model;
  - process-manager slot reader;
  - active-task state;
  - decision function;
  - execution ports;
  - audit/diagnostic logging.
- [ ] Add `requestReconcile({ chatroomId, role, source })` as the only public
      trigger API.
- [ ] Coalesce duplicate requests for the same role while preserving the most
      useful source metadata for diagnostics.
- [ ] Serialize reconciliation per role, independently of the process manager's
      existing serialized operation boundary.
- [ ] Re-read current state when reconciliation begins instead of trusting the
      snapshot that caused the trigger.
- [ ] Reconcile the oldest deliverable task first.
- [ ] Ensure a completed/reassigned task is removed from consideration before
      execution.
- [ ] Make the coordinator return or record the final decision and execution
      result.
- [ ] Add tests for duplicate triggers, concurrent triggers, stale snapshots,
      and task reassignment between trigger and execution.

Acceptance gate:

- [ ] A single coordinator can handle a task trigger and an agent lifecycle
      trigger with the same decision path.
- [ ] Duplicate requests cannot create duplicate injections.

### 4. Separate decision execution from lifecycle and task services

- [ ] Extract a narrow execution port for `startAgent`/agent recovery.
- [ ] Extract a narrow execution port for native task injection.
- [ ] Move `startPendingNativeAgents` behavior behind the coordinator's
      `start-agent` decision and remove it as an independent pass.
- [ ] Keep process-manager serialization as the final boundary for start/stop
      operations.
- [ ] Keep task-service serialization and receipt recording as the final
      boundary for injection.
- [ ] Define execution outcomes for:
  - successful start;
  - start rejected due to stop intent or stale revision;
  - start already in progress;
  - session readiness timeout;
  - injection success;
  - injection failure;
  - task no longer available.
- [ ] Ensure every failure releases the coordinator's per-role lock.
- [ ] Ensure successful injection updates local active-task state exactly once.
- [ ] Add focused executor tests with fake process-manager and task-service
      ports.

Acceptance gate:

- [ ] The process manager does not know about task selection.
- [ ] The task service does not know why a task became eligible.
- [ ] All side effects are reachable through explicit executor ports.

### 5. Route every existing trigger through the coordinator

- [ ] Task inbox notifications request reconciliation for affected roles.
- [ ] Operational-status updates request reconciliation for changed roles.
- [ ] `NativeDeliveryService.handleAgentStarted` requests reconciliation.
- [ ] `NativeDeliveryService.handleAgentTurnEnded` requests reconciliation.
- [ ] Session-loss handling clears active-task state and requests reconciliation
      when the role can recover.
- [ ] Bootstrap requests reconciliation for every role with active task rows.
- [ ] The periodic timer requests reconciliation for roles represented in the
      local task snapshot state; it does not call a separate delivery algorithm.
- [ ] Preserve periodic reconciliation as a bounded safety net during this
      migration. It may be removed later only after equivalent event coverage and
      monitoring exist.
- [ ] Replace restart-specific task listing/filtering with:
  - restart orchestrator performs stop → start → await session → ready;
  - restart orchestrator emits or requests `restart-completed` reconciliation;
  - coordinator makes the same decision as every other trigger.
- [ ] Remove direct production calls to `processSnapshots('restart', ...)` once
      the coordinator owns restart reconciliation.

Acceptance gate:

- [ ] Search shows one production reconciliation entry point.
- [ ] No trigger has its own task readiness filter.
- [ ] Restart, task signal, operational signal, and periodic recovery use the
      same decision function.

### 6. Make observability part of the delivery contract

- [ ] Add structured decision logging with fields:
  - source;
  - chatroom ID;
  - role;
  - task ID when available;
  - decision kind;
  - reason code;
  - slot state;
  - native turn phase;
  - harness session presence;
  - operational state;
  - reconciliation attempt ID.
- [ ] Log the transition from decision to execution and the final result.
- [ ] Replace generic `NativeDelivery:fallback` wording with a trigger log
      followed by a decision log, so fallback is clearly a source rather than an
      implied delivery outcome.
- [ ] Remove or narrow swallowed errors in `restartAgent`; restart failures must
      be visible through the daemon audit/log path.
- [ ] Record whether restart completed with zero, one, or multiple delivered
      tasks.
- [ ] Add tests that assert blocked decisions include stable reason codes.
- [ ] Add an incident diagnostic checklist to the relevant daemon plan or
      harness documentation.

Acceptance gate:

- [ ] A single log sequence distinguishes discovery, decision, and execution.
- [ ] The pending-task incident can be diagnosed without inspecting source code.

### 7. Add end-to-end recovery coverage

- [ ] Add an integration test for:
  - pending task exists;
  - agent is stopped or exited;
  - agent restart completes;
  - coordinator observes ready session;
  - task is injected exactly once.
- [ ] Add an integration test for agent start without a new task signal.
- [ ] Add an integration test for task signal before agent readiness.
- [ ] Add an integration test for operational signal after task snapshot
      hydration.
- [ ] Add an integration test for duplicate restart and periodic triggers.
- [ ] Add an integration test for stale local active-task state after session
      loss.
- [ ] Add an integration test proving completed tasks are not redelivered from a
      stale local snapshot.
- [ ] Add an integration test proving stop intent blocks delivery and later
      reconciliation resumes after the stop intent clears.
- [ ] Preserve and adapt the existing pending-task-after-agent-restart and
      native queued-delivery tests rather than replacing them with only unit tests.

Acceptance gate:

- [ ] Recovery behavior is proven at the coordinator/executor boundary.
- [ ] At least one test reproduces the production incident shape.

### 8. Remove superseded orchestration and verify

- [ ] Delete `startPendingNativeAgents` as an independent orchestration pass,
      or reduce it to a private executor implementation with no decision logic.
- [ ] Remove restart-specific `listDeliverableSnapshots` filtering once the
      coordinator owns readiness evaluation.
- [ ] Remove duplicate calls to `isAgentReadyForNativeDelivery` from trigger
      paths.
- [ ] Retain readiness and cold-session policy only in the canonical decision
      path and its focused domain helpers.
- [ ] Remove obsolete `processSnapshots` pass-specific branching where it no
      longer represents behavior.
- [ ] Search the repository for all of:
  - `processSnapshots(`;
  - `startPendingNativeAgents`;
  - `listDeliverableSnapshots`;
  - `isAgentReadyForNativeDelivery`;
  - `explainNativeDeliveryBlock`;
  - `reconcileAssignedTasks`.
- [ ] Confirm each remaining reference has one documented responsibility.
- [ ] Run CLI typecheck and focused daemon tests.
- [ ] Run backend integration tests covering task transitions and operational
      projections.
- [ ] Run the full test suite and lint/format checks required by the repository.

Acceptance gate:

- [ ] No superseded path can independently inject or start an agent.
- [ ] Typechecks, focused tests, integration tests, and full verification pass.

## Rollout and compatibility

- [ ] Keep the existing periodic safety trigger during the migration.
- [ ] Make the new coordinator observable before removing old diagnostic logs.
- [ ] If a staged rollout is needed, gate the coordinator behind a safe default
      feature flag and compare old/new decisions without executing both side effects.
- [ ] Do not dual-inject or dual-start agents while comparing behavior.
- [ ] Confirm the supported daemon/backend version boundary before deploying any
      new decision or signal contract.
- [ ] After production rollout, monitor:
  - pending-task age by role;
  - delivery decision counts by reason;
  - start-to-injection latency;
  - injection failures;
  - restart completions with zero delivery;
  - duplicate-delivery suppressions;
  - periodic reconciliations required before delivery.

## Final verification checklist

- [ ] `rg` confirms one production reconciliation entry point.
- [ ] Task inbox owns task state only.
- [ ] Process manager owns process state only.
- [ ] Restart orchestrator owns restart lifecycle only.
- [ ] Coordinator owns delivery decisions only.
- [ ] Executors own start/injection side effects only.
- [ ] Decision tests cover every stable reason code.
- [ ] Integration tests cover restart, reconnect, task signal, operational
      signal, turn end, duplicate trigger, and stale-state recovery.
- [ ] Production logs distinguish trigger, decision, execution, and result.
- [ ] CLI typecheck passes.
- [ ] Backend typecheck passes.
- [ ] Focused and full test suites pass.
- [ ] Plan is moved to `docs/plans/completed/` only after the pull request is
      merged and production verification is complete.
