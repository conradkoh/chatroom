# Make Task Delivery Self-Sufficient

## Problem

Native task delivery cannot start an agent on its own: runtime config
(harness/model/workingDir) is resolved from the in-memory slot, which is lost on
daemon restart, so a pending task for a stopped agent is blocked as
`working_dir_missing`, its inbox event is acknowledged without delivery, and the
task is stuck pending forever. Working directory is an attribute of the agent
model (launch request), not the task or the slot.

## Removal checklist

Code that exists to compensate for the missing agent-model read model. Each row
is either removed (✅) or not (⬜).

| #   | Boundary                                | File → Component                                                                                           | Responsibility to remove                                                                                                                                                          | Done |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | daemon/task-service · delivery decision | `delivery-decision.ts` → `stableBlockReason()`                                                             | String-prefix matching over block reasons with `working_dir_missing` fallback (mislabels unknown reasons)                                                                         | ⬜   |
| 2   | daemon/task-service · delivery decision | `assigned-task.ts` → `resolveAgentRuntimeConfig(task, slot)`                                               | Slot-fallback config resolution (`!slot?.harness                                                                                                                                  |      | !slot.workingDir → undefined`) — the circular "config from the running process" dependency | ⬜  |
| 3   | daemon/task-service · delivery decision | `native-ready-invariant.ts` → `explainAgentReadyForNativeDeliveryBlock`                                    | `agent_config_missing` gate duplicating the runtime-config resolution already done in `decideNextDelivery`                                                                        | ⬜   |
| 4   | daemon/task-service · service surface   | `task-service.ts` → `TaskService`                                                                          | `listPendingTaskInboxEvents` and `markTaskInboxEventProcessed` (no production callers)                                                                                            | ⬜   |
| 5   | daemon/task-service · service surface   | `role-delivery-state.ts` → `RoleDeliveryState`                                                             | `nativeNudgeFailures` record/clear/get with no reader                                                                                                                             | ⬜   |
| 6   | daemon/task-service · service surface   | `native-task-delivery-coordinator.ts` → `reconcileRoleTasks`                                               | Hardcoded `deliveryInFlight: false` context field                                                                                                                                 | ⬜   |
| 7   | daemon/task-service · service surface   | `native-task-delivery-coordinator.ts` → `reconcileRoleTasks`                                               | Dead raw-Effect inject branch (`executors` is always provided)                                                                                                                    | ⬜   |
| 8   | daemon/task-service · service surface   | `task-delivery-processor.ts`, `native-task-delivery-coordinator.ts`, `native-delivery-log.ts` → pass types | `LegacyDeliveryPass` aliases (`inbox-signal`, `restart`) and the legacy/extended pass-type split                                                                                  | ⬜   |
| 9   | backend · task inbox                    | `write-workspace-task-inbox-event.ts` → `writeWorkspaceTaskInboxEvent`                                     | Ephemeral-config duplication into task events (`requireEphemeralAgentConfig`, `assignee.ephemeral`) and the silent drop `if (isEphemeralAgentRole && !target.ephemeral) continue` | ⬜   |
| 10  | backend · task inbox                    | `chatroomWorkspaceTaskInbox.ts` + `schema.ts` → `chatroomWorkspaceTaskInbox.assignee`                      | Ephemeral assignee variant, once the daemon resolves agent config from the launch request                                                                                         | ⬜   |

Ordering note: rows 9–10 depend on the additive side (agent config inbox +
daemon registry) landing first.

## Responsibilities to retire

Conditional behaviors rather than components; verifiable the same way.

| #   | Boundary                                | Where                                         | Behavior to retire                                                                                                                                          | Done |
| --- | --------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 11  | daemon/task-service · delivery decision | `delivery-decision.ts` → `decideNextDelivery` | Slot consulted as a config store by delivery decisions (`AgentProcessSlotView.harness/model/workingDir`); slot keeps pid, harnessSessionId, turn phase only | ⬜   |
| 12  | daemon/task-service · delivery decision | `delivery-decision.ts` → `start-agent` branch | `task.status === 'pending'` gate — an acknowledged task with a dead slot must be startable too                                                              | ⬜   |
| 13  | daemon/task-service · inbox lifecycle   | `task-service.ts` → `scheduleEvent`           | Ack-without-delivery: event marked processed after a `blocked` decision, failed start, hydration miss, or failed injection                                  | ⬜   |

## Addition checklist

The replacement path. Each row is either added and verifiable (✅) or not (⬜).

| #   | Boundary                                | Component to add                                                         | Responsibility                                                                                                                                                                                                                                                                                                               | Done |
| --- | --------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 14  | backend · agent config inbox            | `chatroomWorkspaceAgentConfigInbox` table (durable, pending → processed) | When a launch request is recorded (save, start, or restart of a remote agent — all funnel through `recordLastSentLaunchRequest`), a pending config event is written per `(machineId, chatroomId, role)`; payload is the agent config — `agentHarness`, `model`, `workingDir`; same lifecycle as `chatroomWorkspaceTaskInbox` | ✅   |
| 15  | daemon · agent-process-service          | `AgentRegistry` read model                                               | Consumes `chatroomWorkspaceAgentConfigInbox` — watch + boot-time replay of pending events (same pattern as `TaskService`), keyed `chatroomId:role`; validates `agentType === 'remote'` and `machineId` match; acks only after apply                                                                                          | ⬜   |
| 16  | daemon/task-service · delivery decision | `decideNextDelivery` config resolution                                   | Runtime config resolved from `AgentRegistry` at decision time (never cached from an earlier pass) — no slot fallback, no ephemeral/permanent bifurcation                                                                                                                                                                     | ⬜   |
| 17  | daemon/task-service · delivery decision | `decideNextDelivery`                                                     | `start-agent` unconditional for any deliverable task (pending or acknowledged) when the slot is missing/idle; `ensureRunning` stays the idempotent entry point                                                                                                                                                               | ⬜   |
| 18  | daemon/task-service · delivery decision | decision sum type                                                        | Discriminated `waiting(reason)` / `failed(reason)` outcomes replacing `blocked`/`wait` string plumbing; every outcome logged with its reason                                                                                                                                                                                 | ⬜   |
| 19  | daemon/task-service · delivery decision | upfront validation                                                       | Unusable event → immediate `failed`, surfaced once, not retried silently. "No agent config exists for this role" (stale or absent launch request) is `failed`; "config event not yet synced" (inbox lag) is `waiting`, retried by the periodic reconcile — never conflated                                                   | ⬜   |
| 20  | daemon/task-service · inbox lifecycle   | `scheduleEvent`                                                          | Ack only after confirmed injection (receipt recorded + turn accepted); all other outcomes leave the event durably pending with bounded retry                                                                                                                                                                                 | ⬜   |
| 21  | daemon/task-service · injection         | inject action                                                            | Claim folded inside inject for both statuses (idempotent via `claimTask` same-role return); a failed resume/injection surfaces as `failed`, never a silent success                                                                                                                                                           | ⬜   |
| 22  | daemon/task-service · reconcile         | periodic reconcile pass                                                  | Interval re-run of the decision for chatrooms with pending/acknowledged tasks, so delivery self-heals without a triggering event                                                                                                                                                                                             | ⬜   |
| 23  | backend + webapp · failure surfacing    | task status / audit for `failed`                                         | A `failed` decision updates task state or audit so the UI shows why a task is not progressing (start param missing, no launch request, wrong machine)                                                                                                                                                                        | ⬜   |

Ordering: 14–15 before 16–19; 20–21 together; 22 and 23 independent of each
other but after 18.

Consistency notes:

- Inbox rule: no delivery-path sync subscribes across the DB boundary directly;
  every cross-DB sync uses a durable inbox (task events and agent config events
  in `chatroomWorkspaceAgentConfigInbox` are both pending → processed, replayed
  on boot).
- Coverage: inbox events are only ever written to `(machineId, role)` targets
  derived from the launch-request table
  (`listLastSentLaunchRequestsForChatroom`), and the config event is written
  whenever that launch request is recorded (`recordLastSentLaunchRequest`) —
  so a task event is always preceded by its config event. The ephemeral
  duplication in task events buys nothing.
- Freshness: ephemeral config must be read fresh from the registry at
  decision/inject time ("last sent" is mutable; supersessions arrive as new
  inbox events).
