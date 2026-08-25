# Chatroom Stop Command and Daemon Lifecycle Report

## Scope

This report traces the stop behavior discussed in the investigation and evaluates the daemon implementation for clarity, separation of concerns, dependency inversion, process-stop guarantees, and harness-specific stop behavior.

The relevant stop operations are:

1. The chatroom sidebar action, which stops remote agents and command-run processes.
2. The command-palette action, which stops all running remote agents after confirmation.
3. The individual terminal action, which stops one command-run process.

## Executive summary

The implementation has a deliberate layered architecture, but the stop semantics are not represented by one consistent lifecycle contract.

The strongest parts are the event-to-use-case boundary, the injected process-manager ports, the agent slot state machine, and race handling for repeated or out-of-order stop requests.

The main weaknesses are:

- Agent UI state is marked stopped optimistically before the daemon physically stops the process.
- Harness stop failures are swallowed in the lifecycle layer.
- Harness ownership is discovered by trying every registered service for a PID.
- The daemon reports only a weak `success: boolean` outcome for physical agent termination.
- `AgentProcessManager` remains a broad coordinator for many unrelated lifecycle concerns.
- Effect and Promise abstractions are repeatedly converted across the same path.
- Agent stopping and command-run stopping use separate lifecycle mechanisms.

Overall assessment: the code is not ad hoc or unmaintainable, but it is moderately fragmented and has under-specified failure semantics. It is best described as a sound architecture around an over-centralized process manager.

## 1. Stop entry points

### 1.1 Sidebar: stop agents and command processes

Entry point: [`ChatroomSidebar.tsx:57`](../../apps/webapp/src/modules/chatroom/components/ChatroomSidebar.tsx:57)

The handler executes two independent branches concurrently:

```text
handleStop
├─ send machines.sendCommand(type = "stop-agent") for every running agent
└─ send commands.stopAllCommandRunsForChatroom(chatroomId)
```

The sidebar therefore combines agent lifecycle termination and workspace command-process termination, but those branches do not share a common daemon-side lifecycle abstraction.

### 1.2 Command palette: stop all remote agents

Entry point: [`ChatroomDashboard.tsx:1419`](../../apps/webapp/src/modules/chatroom/ChatroomDashboard.tsx:1419)

The action first displays a confirmation dialog, then filters agents in `running` or `starting` state with a machine ID and sends one `stop-agent` command per agent. It uses `Promise.allSettled` to report failed roles.

This path stops agents only. It does not stop command-run processes.

### 1.3 Terminal: stop one command run

Entry point: [`useCommandRunner.ts:88`](../../apps/webapp/src/modules/chatroom/hooks/useCommandRunner.ts:88)

The terminal calls `commands.stopCommand({ machineId, runId })`. This follows the command-run lifecycle, not the agent lifecycle.

## 2. Agent stop path

The complete agent path is:

```text
UI stop action
→ machines.sendCommand
→ backend stopAgent use case
→ chatroom_machineCommandInbox row
→ daemon inbox claim
→ command dispatcher
→ onRequestStopAgentEffect
→ daemon stop-agent use case
→ process-manager port
→ AgentProcessManager
→ AgentLifecycleService
→ harness-specific stop
→ shared process-group termination fallback
```

### 2.1 Backend dispatch

The backend routes `type: "stop-agent"` to the use case at [`machines.ts:1251`](../../services/backend/convex/machines.ts:1251).

The backend use case, [`stop-agent.ts:57`](../../services/backend/src/domain/usecase/agent/stop-agent.ts:57), performs all of the following before the daemon executes the stop:

- Resolves the chatroom's team-level agent configuration.
- Reads the persisted agent PID.
- Enqueues an `agent.requestStop` command containing chatroom, role, reason, and optional PID.
- Transitions the participant to `agent.exited` with desired state `stopped`.
- Sets team configuration `desiredState: 'stopped'`.
- Clears `spawnedAgentPid` and `spawnedAt`.
- Releases in-flight tasks.

### 2.2 Daemon command delivery

The daemon watches `chatroom_machineCommandInbox`, claims the command, and passes it through the command dispatch layer:

- Subscriber: [`machine-command-inbox.ts`](../../packages/cli/src/daemon/infrastructure/convex/subscribers/machine-command-inbox.ts)
- Dispatcher: [`command-dispatch.ts`](../../packages/cli/src/daemon/entry/command-dispatch.ts)
- Event handler: [`on-request-stop-agent.ts`](../../packages/cli/src/daemon/entry/events/agent/on-request-stop-agent.ts)

After the handler resolves, the command is acknowledged and deleted. The dispatcher also renews the claim lease while the handler is running and deduplicates command IDs.

### 2.3 Daemon use case and process manager

The daemon use case is intentionally small: [`domain/usecase/stop-agent.ts`](../../packages/cli/src/daemon/domain/usecase/stop-agent.ts).

It:

- Rejects expired commands by skipping them.
- Logs the request.
- Calls `StopAgentProcessManagerPort.stop`.
- Converts the result to a log-oriented `CommandResult`.

The bridge supplies the concrete process-manager implementation through [`agent-control-bridge.ts:87`](../../packages/cli/src/daemon/entry/bridge/agent-control-bridge.ts:87).

`AgentProcessManager.stop` handles:

- No slot or idle slot.
- Already-stopping slots.
- Missing PIDs.
- Synchronous transition to `stopping`.
- Reuse of an existing `pendingOperation` for concurrent callers.

See [`agent-process-manager.ts:417`](../../packages/cli/src/daemon/infrastructure/agent-process-manager/agent-process-manager.ts:417).

The synchronous `stopping` claim is a strong part of the implementation because it prevents concurrent callers from starting independent stop operations for the same slot.

## 3. Command-run stop path

The command-run path is separate:

```text
UI stop action
→ commands.stopCommand or stopAllCommandRunsForChatroom
→ handleStopCommand
→ commandRunsV2 terminationReason = user-stop
→ daemon command-run subscriber
→ onCommandStopEffect
→ ProcessManager lookup
→ SIGTERM process group
→ wait
→ SIGKILL fallback
→ commands.updateRunStatus(status = stopped)
```

The chatroom-wide operation is implemented in [`stop-all-command-runs-for-chatroom.ts:18`](../../services/backend/src/domain/usecase/commands/stop-all-command-runs-for-chatroom.ts:18). It finds registered workspaces, queries command runs by `(machineId, workingDir)`, and handles pending or running runs.

For each run, [`commands/mutations.ts:72`](../../services/backend/convex/commands/mutations.ts:72) behaves differently by state:

- `pending`: immediately changes to `stopped` with `terminationReason: 'user-stop'`.
- `running`: only sets `terminationReason: 'user-stop'`; the daemon performs the physical stop.

The daemon subscription is [`command-run.ts`](../../packages/cli/src/daemon/infrastructure/convex/subscribers/command-run.ts), with execution in [`command-runner.ts:196`](../../packages/cli/src/daemon/entry/handlers/command-runner.ts:196).

The runner supports a stop-before-start race through `pendingStops`. If no process is registered, it records a pending stop and reports the run stopped. If a process is present, it sets `terminationIntent: 'stopped'`, sends SIGTERM, waits, and escalates to SIGKILL through [`killer.ts`](../../packages/cli/src/daemon/entry/handlers/process/killer.ts).

One documented tradeoff is that command runs are keyed by machine and working directory. A chatroom-wide stop can therefore affect another chatroom sharing the same workspace.

## 4. Is the daemon stop sequence clear or fragmented?

### Clear aspects

The agent stop path has a recognizable set of layers:

```text
transport subscriber
→ command dispatcher
→ event handler
→ domain use case
→ injected port
→ process manager
→ lifecycle state machine
→ harness adapter
```

The event handler does not contain process-killing logic. The daemon use case does not directly import Node process APIs. The lifecycle service owns slot transitions. These are good separation-of-concern decisions.

The command-run path is also internally understandable and has good race handling.

### Fragmented aspects

The complete agent path crosses many abstraction boundaries for a relatively small operation:

```text
machineCommandInbox
→ command-inbound registry
→ command dispatcher
→ Effect handler
→ bridge
→ Promise use case
→ Effect service
→ AgentProcessManager
→ AgentLifecycleService
→ harness adapter
```

Some of this is justified by the daemon's Effect architecture and migration history, but it raises the cost of tracing behavior. The code uses repeated `Effect.promise` and `Effect.runPromise` conversions, which makes error propagation harder to inspect.

There are also two independent stop systems: agent processes use `AgentProcessManager` and the lifecycle service, while command runs use a separate global `ProcessManager` and command runner.

## 5. Separation of concerns and dependency inversion

### Positive findings

Dependency inversion is present and meaningful:

- The daemon stop use case depends on `StopAgentProcessManagerPort`, not `AgentProcessManager`.
- The lifecycle service depends on `HarnessSpawnPort`, not directly on SDK implementations.
- `DaemonAgentProcessManagerService` exposes a service shape through an Effect context tag.
- The bridge is responsible for adapting concrete daemon services to application ports.

This makes the stop use case and event handler straightforward to unit test with fakes.

### Limitations

The process manager is still a large coordinator with many responsibilities, including:

- spawning and stopping;
- PID persistence;
- crash-loop protection;
- restart decisions;
- harness sessions;
- native delivery;
- provider-failure classification;
- lifecycle outbox emission;
- turn completion;
- resume-storm handling;
- recovery.

The manager receives dependencies rather than constructing them, which is good dependency injection, but its dependency surface is very broad. This is dependency inversion without strong dependency segregation.

## 6. Is UI stopped guaranteed to mean the process is stopped?

### Agent processes: no

The backend marks the agent stopped before the daemon acts:

```text
enqueue agent.requestStop
→ mark participant agent.exited / stopped
→ set desiredState = stopped
→ UI shows OFFLINE
→ daemon later attempts physical termination
```

Therefore, the UI's stopped state means “stop requested and backend projected as stopped,” not “the OS or SDK process has definitely exited.”

The persisted PID is also cleared before physical termination. A delayed, expired, or failed daemon command can leave the UI and backend projection stopped while a process remains alive.

### Command runs: mixed

- Pending runs are stopped optimistically in the backend.
- Running runs retain `status: 'running'` while the daemon handles the stop request.
- The final `stopped` status is normally reported by the daemon after the process-stop path.

This gives command runs a stronger relationship between final UI state and physical process handling than agent stops, but pending runs still have an optimistic path.

## 7. Harness-specific stop abstraction

There is a genuine abstraction. Each harness implements:

```ts
stop(pid: number, options?: AgentStopOptions): Promise<void>
```

The common base implementation performs OS-level termination:

```text
SIGTERM process group
→ poll for exit
→ SIGKILL after timeout
```

Harness implementations add their own graceful cleanup before calling the base implementation:

- OpenCode aborts the remote session and removes session metadata.
- Pi aborts and disposes its SDK session and kills its keeper.
- Codex aborts its controller and kills its keeper.
- Claude interrupts the active query and kills its keeper.
- Cursor cancels the current run and can preserve the session for resume.

This is a sensible “harness-specific graceful stop plus shared OS fallback” model.

### Weaknesses in the abstraction

The contract returns only `Promise<void>`. It does not express:

- whether SDK cancellation succeeded;
- whether the process exited;
- whether termination was graceful or forced;
- whether a session was preserved;
- whether the harness already considered the process absent.

The lifecycle service also ignores stop errors with `Effect.ignore`, so failures from the harness layer do not reliably reach the daemon stop result.

More seriously, the port adapter finds the owning harness by trying every registered service:

```ts
for (const service of deps.agentServices.values()) {
  try {
    await service.stop(pid, opts);
    return;
  } catch {
    // try next
  }
}
```

See [`agent-lifecycle-port-adapters.ts:93`](../../packages/cli/src/infrastructure/services/agent-lifecycle/agent-lifecycle-port-adapters.ts:93).

This means:

- harness ownership is inferred through exceptions;
- all exceptions are treated as “not my PID”;
- no explicit owner is selected from the slot's harness metadata;
- no-service-found and stop-failed can become indistinguishable;
- the adapter can complete without reporting that no service handled the PID.

This is the most haphazard part of the harness abstraction.

## 8. Key risks

### High priority

1. **Optimistic agent stopped state**

The UI and backend can report stopped before physical termination. This is a semantic mismatch if stopped is expected to mean process-free.

2. **Stop failures are swallowed**

`AgentLifecycleService` ignores harness stop errors, and the daemon event handler acknowledges the inbox command after the use case returns. Physical failures do not reliably produce a backend failure state.

3. **Harness lookup by trial and error**

The adapter should use the harness recorded in the slot/config rather than iterate all services.

### Medium priority

4. **Weak stop result model**

`success: boolean` and `Promise<void>` cannot distinguish stopped, already absent, expired, preserved, or failed.

5. **Large process manager**

`AgentProcessManager` has too many responsibilities and remains a high-risk change surface.

6. **Mixed Effect and Promise layers**

Repeated conversions obscure error and cancellation behavior.

### Known operational tradeoff

7. **Workspace-level command stop scope**

Stopping all command runs for a chatroom can affect another chatroom sharing the same machine and working directory.

## 9. Recommended direction

### First: clarify stop outcomes

Introduce an explicit result model, for example:

```ts
type StopOutcome =
  | { kind: 'stopped'; pid: number }
  | { kind: 'already-exited'; pid?: number }
  | { kind: 'preserved-for-resume'; pid: number }
  | { kind: 'expired' }
  | { kind: 'failed'; error: string };
```

Use it consistently across:

- harness services;
- lifecycle service;
- process manager;
- daemon event handling;
- backend lifecycle reporting.

### Second: select the harness explicitly

Store or pass the harness identity with the slot and resolve the service directly. Avoid using exceptions as a service-discovery mechanism.

### Third: separate requested from confirmed state

Use a state sequence such as:

```text
running → stop_requested → stopping → stopped
                         └→ stop_failed
```

The UI can still display a responsive stop-requested state while preserving the distinction between a request and confirmed termination.

### Fourth: reduce manager responsibility

Extract focused components for:

- process termination;
- harness session cleanup;
- lifecycle state transitions;
- restart policy;
- backend/lifecycle event emission.

`AgentProcessManager` can remain as an orchestration facade while delegating these responsibilities.

## Final assessment

The daemon is architecturally intentional and has several strong boundaries. The stop sequence is traceable once the layers are known, and the agent slot state machine has good concurrency safeguards.

However, the current design does not provide a strict guarantee that a UI-stopped agent is physically stopped. Harnesses can customize graceful cleanup, but the contract and adapter do not reliably report the physical outcome. The implementation is therefore best characterized as moderately fragmented, with good dependency-inversion patterns around a highly centralized and weakly typed stop core.
