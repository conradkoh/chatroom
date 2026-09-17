---
type: decision-log
title: Task-state ownership moves from the Convex FSM to the daemon
description: Backend claim-pending FSM gate removed; daemon owns task-state decisions; shutdown releases all machine non-pending tasks, restart delegates to the task service.
tags: [tasks, daemon, migration, fsm]
status: stable
merged: 2026-09-17
---

# Task-state ownership moves from the Convex FSM to the daemon

## Context

The backend FSM (`convex/lib/taskStateMachine.ts`) enforced state-machine
invariants while Convex held the consistent snapshot of task state. As state
consistency migrates to the daemon's task service, backend validations that
gate transitions on state have started fighting the daemon:

- The enhancer delivery livelock: the enhancer job path claimed tasks straight
  to `in_progress`, so every generic native-delivery `claimTask` attempt threw
  "Task must be pending to claim (current status: in_progress)" forever, masked
  in the UI as `injection_not_confirmed`.
- On agent restart, the backend released all in-flight tasks to `pending`
  indiscriminately (`requestAgentRestart` → `releaseTasksOnAgentExit`) before
  the daemon got any say.

## Decision (2026-09-17)

1. **`claimTask` is no longer FSM-gated.** An `acknowledged` or `in_progress`
   task assigned to the claiming role is an idempotent re-claim (returns the
   task unchanged, no transition, no inbox events). Cross-role non-pending
   claims are still rejected — that is role ownership, not FSM state. Pending
   claims acknowledge as before; terminal states stay unclaimable.
2. **Daemon shutdown releases machine-wide.** New
   `releaseTasksOnDaemonShutdown` usecase + `daemon.taskStatus.releaseMachineTasks`
   mutation: every `acknowledged`/`in_progress` task assigned to roles launched
   on the machine (per `chatroom_agentLastSentLaunchRequests`) moves back to
   `pending` (`releaseTasksOnDaemonShutdown` FSM trigger, agent-status update
   skipped). `on-daemon-shutdown` calls it instead of the per-role local release
   loop, so it also covers tasks the local read model lost.
3. **Agent restart is a task-service decision, not a backend decision.**
   `requestAgentRestart` no longer releases tasks. The restart orchestrator
   notifies the agent process service (`AgentWorkManager.handleAgentRestart` —
   resets delivery mutex + agent task state) which delegates to
   `taskService.handleAgentRestart`: the task service decides — reset the V2
   redelivery cap (user intervention) and release acknowledged/in_progress
   tasks to `pending` via the authoritative per-task path
   (`releaseTaskAfterTurnFailure`), so the fresh agent reprocesses them.

**These behaviors are provisional, not invariants.** They are reasonable
defaults for the current migration state and may be wrong — particularly the
blanket shutdown release (it discards agent work without asking whether the
turn had actually progressed) and the restart release (it discards claimed-
but-unstarted work). Revisit both once the daemon's task service has a real
task model and can make per-task decisions instead of blanket ones.

## Shared release skeleton

`transitionInFlightTasksToPending` (in `release-tasks-on-agent-exit.ts`) is the
single in-flight-release loop: caller-owned FSM trigger, optional role filter,
optional overrides. `releaseTasksOnAgentExit` (chatroom-stop enhancer
interrupt), both team-switch reassignment flows, and the daemon-shutdown
release all delegate to it. `listChatroomTasksByStatus` is the shared
chatroom+status query.

## Consequences

- More backend FSM validations will be removed as the daemon's task service
  grows; weigh each on whether the daemon has foundations to enforce the
  invariant. The claim-pending check is NOT re-added on the daemon yet —
  the daemon task service has no full task model; future work.
- `releasedTaskCount` removed from `AgentRestartResult` (backend no longer
  releases at restart-request time; `restart-agent.spec` now asserts the task
  stays `acknowledged` until the machine acts).
- `taskService.handleAgentRestart` is the current path for restart-time task
  decisions; keep task decisions out of backend restart flows while the
  migration is in progress.

## Follow-up: enhancer job pipeline retired (2026-09-17)

`90fc541e0` (delivery switch) + `1e83f0830` (schema drop) removed the
enhancer job pipeline entirely — `chatroom_enhancerJobs`, the daemon job
subscriber/drain/spawn registries, claimForSpawn/getTaskDeliveryForJob,
the reaper, and attempt bookkeeping. The enhancer is now delivered exactly
like permanent agents: standard ingress → inbox event → idempotent claim →
slot spawn with the standard delivery prompt → receipt lifecycle →
handoff-only completion; retry/salvage via turn-failure release + the V2
cap + bootstrap sweep.

- The planner draft ("original") for the UI diff now travels on the
  enhanced handoff message itself (`messages.enhancerOriginalContent`),
  stamped at handoff from the completed enhancer task's content.
- Historical enhancer diffs (old job draftContent) are not backfilled —
  old timelines lose the original-vs-enhanced toggle.
- The webapp hook is task-based (`getActiveJob`/`cancelActiveJob` read the
  in-flight enhancer task; cancel delivers the planning-review-outcome
  cancelled handoff).
