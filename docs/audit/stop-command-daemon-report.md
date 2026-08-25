# Chatroom Stop Command and Daemon Lifecycle Report

## Scope

This is a post-migration audit of PR #1506's durable agent-stop path. It covers the webapp request boundaries, backend aggregate, exact-target daemon execution, and lifecycle-driven presentation.

## Executive summary

Agent stopping now has one durable aggregate per logical action. The backend snapshots immutable PID targets and machine executions, the daemon claims and executes only those targets, and lifecycle facts update the projection after physical termination. The UI presents pending, stopping, failed, and stopped state from `agentRoleView.stopState` rather than treating a request as an immediate physical success.

The command-run process path remains a separate lifecycle, but the sidebar coordinates it independently from agent stopping. This makes partial failure visible without allowing one branch to prevent the other from running.

## 1. Current entry points

### Individual agent

Agent controls call `useAgentStop().requestAgentStop`, which invokes `api.agentStops.requestAgent` once with the chatroom, machine, role, and `user.stop` reason. The UI disables the control while the projected state is `pending` or `stopping`; `failed` remains retryable.

### Chatroom-wide agent stop

The Agents panel and dashboard confirmation call `requestChatroomStop`, which invokes `api.agentStops.requestChatroom` once for the chatroom. There is no client-side per-agent request fanout. The dashboard confirmation bridges the short interval before the projection updates with local submission state.

### Sidebar stop

The sidebar requires confirmation and then runs the agent aggregate request and `stopAllCommandRunsForChatroom` in independent `Promise.allSettled` branches. Each branch reports its own error, and one rejected branch does not skip the other.

## 2. Backend aggregate

`requestAgent` and `requestChatroom` select current stoppable remote configurations and create one durable command. Each target records its `agentConfigId`, normalized role, machine, harness, PID, target key, and revision key at creation time. Distinct machines receive machine execution rows and `agent.stopScope` inbox commands.

Pending or processing commands superseded by a newer request become `superseded`; they are never rewritten as successful physical stops. Reports are chain-validated against pre-created target rows and duplicate terminal reports are idempotent. Lifecycle application is per successful target and is revision/PID-gated before clearing persisted state.

## 3. Exact-target daemon path

The inbox flow is:

```text
agent.stopScope inbox event
→ executeScopedStopForCommand
→ beginMachineExecution
→ exact targets returned by the backend
→ runExactTargetsStop
→ reportTargetOutcome per target
→ completeMachineExecution
→ success-only slot synchronization
```

The daemon does not rediscover replacement processes for durable inbox commands. Legacy `agent.requestStop` role stops retain discovery only at their adapter boundary. Graceful timeout, harness errors, and still-alive processes use the force-kill fallback; a lifecycle delivery warning is reported separately from physical stop failure.

## 4. UI truth and residual constraints

The durable path does not show a stopped result before physical confirmation. `agentRoleView.stopState` is the projection-driven source of truth; local submission flags only cover the mutation-to-projection gap. A failed command displays retry affordances.

Two timeout policies are intentionally retained: scoped fanout uses `SCOPE_TARGET_STOP_TIMEOUT_MS` (10 seconds per target), while direct single-agent `doStop` uses `STOPPING_TIMEOUT_MS` (30 seconds). They serve different execution paths and are not aligned here.

The scoped CI workflow deliberately excludes known unrelated legacy/integration failures, including deferred stop-agent and ensure-only-agent-for-role specifications. This audit does not claim those unrelated suites are green.

## References

- PR: https://github.com/conradkoh/chatroom/pull/1506
- Architecture decision: [agent-stop-golden-path.md](../../memory/architecture/agent-stop-golden-path.md)
