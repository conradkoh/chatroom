# Agent Stop Command Discovery

## Scope

This document traces the flows that can stop a remote agent and explains how a
stuck stopping slot produces:

```text
[TaskMonitor] cleared stuck stopping slot for <role>@<chatroomId>
```

The exact log is emitted in
[`task-delivery-processor.ts`](packages/cli/src/daemon/entry/native-delivery/task-delivery-processor.ts:212).

## What “stuck stopping” means

An in-memory agent slot is considered stuck when:

```text
slot exists
AND slot.state === "stopping"
AND elapsed time since slot.stoppingSince >= 30 seconds
```

The timeout is defined as `STOPPING_TIMEOUT_MS = 30_000` in
[`agent-process-manager.ts`](packages/cli/src/daemon/infrastructure/agent-process-manager/agent-process-manager.ts:265).

The cleanup check is implemented by
[`clearStuckStoppingSlot`](packages/cli/src/daemon/infrastructure/agent-process-manager/agent-process-manager.ts:1368).
If `stoppingSince` is missing, the code treats the slot as already timed out.

## UI stop flow

The `Stop agents` quick-action button is rendered by
[`RemoteAgentQuickActions.tsx`](apps/webapp/src/modules/chatroom/components/AgentPanel/RemoteAgentQuickActions.tsx:59).

```text
User clicks “Stop agents”
  → AgentPanel.onStopAllRemoteAgents
  → ChatroomDashboard.handleStopAllRemoteAgents
  → useAgentStop.requestChatroomStop
  → api.agentStops.requestChatroom
  → backend creates a chatroom-scoped stop command
  → machine command inbox
  → daemon command dispatcher
  → agent.stopScope
  → executeScopedStopForCommand
  → AgentProcessManager.stop()
  → slot.state = "stopping"
  → slot.stoppingSince = now
```

Relevant locations:

- Dashboard handler: [`ChatroomDashboard.tsx`](apps/webapp/src/modules/chatroom/ChatroomDashboard.tsx:1413)
- Stop hook: [`useAgentStop.ts`](apps/webapp/src/modules/chatroom/hooks/useAgentStop.ts:28)
- Backend request mutation: [`agentStops.ts`](services/backend/convex/agentStops.ts:83)
- Daemon command subscription: [`machine-command-inbox.ts`](packages/cli/src/daemon/infrastructure/convex/subscribers/machine-command-inbox.ts:42)
- Command dispatch: [`command-dispatch.ts`](packages/cli/src/daemon/entry/command-dispatch.ts:308)
- Stop execution: [`execute-scoped-stop-command.ts`](packages/cli/src/daemon/entry/execute-scoped-stop-command.ts:15)

The button starts the stopping lifecycle. It does not itself emit the
`[TaskMonitor] cleared...` message. That message is emitted later if the stop
has remained in `stopping` beyond the timeout and recovery runs.

## Other durable stop-command triggers

All of these eventually call `createAgentStopCommand` or
`applyAgentStopCommand`, which persist a stop command and enqueue an
`agent.stopScope` command for the relevant machine.

### Team switch

```text
updateTeam
  → identify outgoing remote agents
  → createAgentStopCommand
  → reason: platform.team_switch
  → chatroom-scoped agent.stopScope command
```

Source: [`update-team.ts`](services/backend/src/domain/usecase/team/update-team.ts:77)

### Stale or duplicate team-agent configuration cleanup

```text
patchTeamAgentConfig
  → deleteStaleTeamAgentConfigs
  → createAgentStopCommand
  → reason: platform.dedup
```

Source: [`patch-team-agent-config.ts`](services/backend/src/domain/usecase/machine/patch-team-agent-config.ts:108)

### Enforcing one machine per role

When an agent is registered on a machine, the backend checks for conflicting
remote configurations for the same role.

```text
recordRemoteAgentRegistered / recordCustomAgentRegistered
  → ensureOnlyAgentForRole
  → createAgentStopCommand
  → reason: platform.dedup
```

Source: [`ensure-only-agent-for-role.ts`](services/backend/src/domain/usecase/agent/ensure-only-agent-for-role.ts:51)

### Ephemeral agent completion

Ephemeral roles such as enhancer can be stopped after their task completes.

```text
ephemeral task or enhancer completes
  → requestEphemeralAgentRelease
  → applyAgentStopCommand
  → reason: platform.ephemeral_task_complete
  → agent.stopScope command
```

Source: [`request-ephemeral-agent-release.ts`](services/backend/src/domain/usecase/agent/request-ephemeral-agent-release.ts:9)

### Explicit backend stop request APIs

The backend exposes agent-, machine-scope-, and chatroom-scope request
mutations:

- `agentStops.requestAgent`
- `agentStops.requestMachineScope`
- `agentStops.requestChatroom`

These all validate access, select target configurations, and create a durable
stop command in [`agentStops.ts`](services/backend/convex/agentStops.ts:24).

## Common durable-command path

```text
Backend trigger
  → createAgentStopCommand / applyAgentStopCommand
  → chatroom_agentStopCommands row
  → chatroom_agentStopTargets rows
  → chatroom_machineCommandInbox row
  → daemon machine-command subscriber
  → agent.stopScope dispatch
  → executeScopedStopForCommand
  → AgentProcessManager.stop()
  → local slot enters "stopping"
```

The command enqueueing is implemented in
[`apply-agent-stop-command.ts`](services/backend/src/domain/usecase/agent/apply-agent-stop-command.ts:37).

## Direct daemon stop flows

These paths call `AgentProcessManager.stop()` directly and do not create a
backend `agent.stopScope` command.

### Daemon shutdown

```text
Daemon shutdown
  → list active agents
  → AgentProcessManager.stop()
  → reason: daemon.shutdown
```

Source: [`on-daemon-shutdown.ts`](packages/cli/src/events/lifecycle/on-daemon-shutdown.ts:31)

### Agent restart

```text
Restart request
  → restart orchestrator
  → AgentProcessManager.stop()
  → reason: user.restart
  → spawn replacement agent
```

Source: [`restart-orchestrator.ts`](packages/cli/src/daemon/entry/restart-orchestrator.ts:262)

### Cold-session delivery and local recovery

Native delivery/recovery can stop a conflicting or stale local process before
continuing delivery. These are direct process-manager calls rather than
durable backend stop commands.

## How the TaskMonitor log is reached

After any stop flow leaves a slot in `stopping`, the exact log can be reached
when a delivery pass has task snapshots for that role:

```text
Task signal, operational signal, daemon bootstrap, or periodic reconcile
  → processTasksUpdate
  → normalizeStuckStoppingSlots
  → clearStuckStoppingSlotIfNeeded
  → agentMgr.clearStuckStoppingSlot
  → slot is stopping for at least 30 seconds
  → force-clear slot
  → [TaskMonitor] cleared stuck stopping slot...
```

Relevant locations:

- Task inbox handler: [`task-inbox-delivery.ts`](packages/cli/src/daemon/infrastructure/inbox/task-inbox-delivery.ts:31)
- Task processing: [`task-delivery-processor.ts`](packages/cli/src/daemon/entry/native-delivery/task-delivery-processor.ts:284)
- Stuck-slot normalization: [`task-delivery-processor.ts`](packages/cli/src/daemon/entry/native-delivery/task-delivery-processor.ts:222)
- Periodic fallback reconcile: [`task-inbox-runtime.ts`](packages/cli/src/daemon/entry/task-inbox-runtime.ts:472)

The recovery pass is separate from the original stop request. Therefore, the
presence of the `[TaskMonitor] cleared...` log means that a later daemon pass
observed and cleared an expired local stopping slot; it does not identify
which original flow initiated the stop by itself.

## Concurrency and lifecycle race conditions

The stop operation is not generally safe to run concurrently with another stop,
start, restart, or recovery operation for the same logical agent slot:

```text
logical lifecycle key = (chatroomId, role)

start ─┐
stop  ─┼─> should be serialized by the daemon
restart┘
recover
```

### Stop versus stop

Direct calls to `AgentProcessManager.stop()` have local coalescing through
`slot.pendingOperation`; a second call can await the first operation.
However, durable `agent.stopScope` execution follows a different path:

```text
agent.stopScope
  → executeScopedStopForCommand
  → runExactTargetsStop
  → stopAgentConfirmed
  → harnessStop.stop(pid)
```

This path calls the harness adapter directly and bypasses the manager's
`pendingOperation` coalescing. Two distinct stop commands that target the same
`(machineId, chatroomId, role, pid)` can therefore invoke the harness stop
concurrently. Backend command supersession reduces duplicate work, but it does
not cancel a command that has already started executing on the daemon.

### Stop versus start

`ensureRunning()` checks `slot.stopRequested` and the active chatroom stop
barrier, which prevents many accidental starts. It is not a complete
serialization mechanism, though. Explicit start reasons can clear stop intent,
and a start command can race with a durable stop command that is executing
through the direct target-stop path.

The UI disables Start while its local stopping state is set, but this is only a
client-side guard and does not cover stale clients, other sessions, backend
triggers, or daemon-internal recovery.

Relevant code:

- Start handler: [`start-agent.ts`](packages/cli/src/daemon/domain/usecase/start-agent.ts:42)
- Start state checks: [`agent-process-manager.ts`](packages/cli/src/daemon/infrastructure/agent-process-manager/agent-process-manager.ts:390)
- Stop-scope execution: [`execute-scoped-stop-command.ts`](packages/cli/src/daemon/entry/execute-scoped-stop-command.ts:15)
- UI quick actions: [`RemoteAgentQuickActions.tsx`](apps/webapp/src/modules/chatroom/components/AgentPanel/RemoteAgentQuickActions.tsx:39)

### Stop versus restart

Restart is ordered internally as stop → spawn → ready → pending-task delivery,
but that sequence is not atomic relative to independently delivered stop or
start commands:

```text
restart:
  stop()
  ────────────────┐
                  ├─ ensureRunning()
                  └─ deliver pending tasks

independent stop:
  direct harness stop(pid)
```

A stop can overlap the restart's spawn, session-readiness wait, or task delivery
phase. A late stop may terminate the replacement process, while a restart can
revive an agent after a stop request has already claimed the slot.

Source: [`restart-orchestrator.ts`](packages/cli/src/daemon/entry/restart-orchestrator.ts:244)

### Existing coordination foundations

The daemon already contains useful building blocks:

- `slot.pendingOperation` serializes direct operations for one in-memory slot.
- `createChatroomScopeBarrier()` blocks starts and task recovery during an
  active stop scope, but currently permits multiple stop scopes concurrently.
- `workspace-sync-queue.ts` implements a keyed serial queue with per-key state
  and cleanup, although its trailing coalescing behavior is specific to file
  synchronization.
- The command inbox and `beginMachineStopExecution()` provide durable
  deduplication/claiming for repeated delivery of one stop command.

The missing coordination boundary is a daemon-owned keyed lifecycle queue that
routes start, stop, restart, and recovery through the same key, preferably
`(chatroomId, role)`. Stop targets should still include the PID and lifecycle
revision so a late command cannot act on a newer process incarnation.
