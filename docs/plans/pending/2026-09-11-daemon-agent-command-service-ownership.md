# Move agent command transport ownership into the daemon service

## Objective

Move agent-command inbox consumption, stopped-fact outbox delivery, lifecycle
coordination, and command materialized state out of
`operational-inbox-runtime.ts` and into the daemon's agent-command service.

The operational inbox entrypoint should remain a composition and supervision
boundary. It should not construct or coordinate the agent-command transport
adapters, durable outbox, retry behavior, or command shutdown sequence.

The change must preserve:

- durable inbox claim, lease renewal, acknowledgement, and retry behavior;
- durable stopped-fact delivery through the local outbox;
- serialized agent stop execution;
- graceful shutdown ordering, including draining in-flight commands and facts;
- idempotent command/fact processing;
- machine ownership and chatroom scoping;
- testability of command processing without the full daemon runtime.

## Scope

This plan extracts the dedicated `agent.stop` command bridge introduced by the
agent-stop inbox migration. It does not merge the backend operational-signal
watchers into the agent-command service.

Operational status signals, task delivery signals, and agent command transport
have different responsibilities:

- `TaskService` owns task inbox state and task delivery state.
- The operational runtime owns operational-signal watcher membership and
  operational read-model updates.
- `AgentCommandService` owns machine-scoped agent command execution and its
  command/fact transport lifecycle.

Shared cursor, retry, subscription, and materialized-state primitives may be
extracted later, but the first migration should preserve these ownership
boundaries.

## Current state

The agent-command bridge is currently assembled in
`packages/cli/src/daemon/entry/operational-inbox-runtime.ts`:

```text
operational-inbox-runtime
  ├── createAgentCommandInbox()
  ├── createAgentCommandFactOutbox()
  ├── startDaemonAgentCommandRuntime()
  ├── owns bridge reference
  └── owns bridge shutdown ordering
```

The agent-command service package contains the domain service and consumer,
but the composition root still owns the infrastructure adapters and the
long-lived runtime handle. This leaves transport state invisible to the
service and makes the operational runtime responsible for unrelated lifecycle
concerns.

Relevant current files:

- `packages/cli/src/daemon/entry/operational-inbox-runtime.ts`
- `packages/cli/src/daemon/services/agent-command-service/composition/agent-command-runtime.ts`
- `packages/cli/src/daemon/services/agent-command-service/service/agent-command-service.ts`
- `packages/cli/src/daemon/services/agent-command-service/service/agent-command-inbox-consumer.ts`
- `packages/cli/src/daemon/infrastructure/convex/agent-command-inbox.ts`
- `packages/cli/src/daemon/infrastructure/outbox/agent-command-fact-outbox.ts`
- `packages/cli/src/daemon/infrastructure/outbox/agent-command-fact-send.ts`

## Target architecture

```text
daemon composition
        ↓
AgentCommandService.start()
        ↓
AgentCommandRuntime
  ├── Convex agent-command inbox adapter
  ├── AgentCommandInboxConsumer
  ├── AgentCommandService domain logic
  ├── durable stopped-fact outbox
  └── AgentCommandMaterializedState
        ↓
  getState() / subscribe()

AgentCommandService.stop()
  ├── stop accepting new claims
  ├── await in-flight command processing
  ├── flush durable stopped facts
  └── close transport resources
```

The service should expose a small read-only state surface. The first version
should be deliberately modest and extensible:

```ts
type AgentCommandServiceState = {
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'degraded';
  activeCommandId?: string;
  activeIntentId?: string;
  processedCount: number;
  failedCount: number;
  lastFactAt?: number;
  lastError?: string;
};
```

The service façade is the single supported callable interface for other daemon
components:

```ts
interface DaemonAgentCommandService {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): AgentCommandServiceState;
  subscribe(listener: (state: AgentCommandServiceState) => void): () => void;
}
```

Other components obtain this façade through daemon service composition or an
Effect service tag. They do not call the domain `stop()` method, start the
inbox consumer, claim/ack/renew inbox rows, append facts, flush the outbox, or
construct the service's adapters. Command execution remains an internal
implementation detail of the façade's inbox-driven runtime.

The materialized state is a daemon read model, not a second source of truth.
Convex remains authoritative for command and stop projections; the local state
exists for diagnostics, observability, and future daemon consumers.

## Implementation sequence

### 1. Define the service-owned lifecycle and state contract

- [ ] Add an `AgentCommandServiceRuntime` or equivalent long-lived service
      contract with `start()`, `stop()`, `getState()`, and `subscribe()`.
- [ ] Establish `DaemonAgentCommandService` as the only public daemon-facing
      façade and route all production consumers through it.
- [ ] Define immutable state snapshots and a small state transition helper.
- [ ] Ensure state transitions are emitted for startup, claim, processing,
      successful completion, partial failure, transport failure, shutdown, and
      degraded/retry conditions.
- [ ] Keep domain command execution independent from the materialized state so
      the pure service tests remain focused and deterministic.
- [ ] Document whether state is process-local and reset on daemon restart.

Acceptance gate:

- [ ] The service can be constructed and queried without starting Convex
      subscriptions.
- [ ] State updates are observable without exposing mutable internal maps or
      adapters.

### 2. Move bridge composition into the agent-command service package

- [ ] Move construction of the Convex inbox adapter into the agent-command
      composition layer.
- [ ] Move construction of the durable fact outbox and Convex fact sender into
      the same composition layer.
- [ ] Make the service composition accept session/backend/process-manager
      dependencies rather than accepting already-composed inbox/outbox objects
      from the operational runtime.
- [ ] Keep infrastructure adapters under `infrastructure/`; only their
      composition and lifecycle ownership move into the service package.
- [ ] Make startup failure transition the service to `degraded` and clean up
      any partially-created resources.

Acceptance gate:

- [ ] `operational-inbox-runtime.ts` no longer imports or constructs the agent
      command inbox, fact outbox, fact sender, or command consumer.
- [ ] No agent-command adapter needs to be passed through an unrelated
      operational-runtime closure.

### 3. Make shutdown service-owned and deterministic

- [ ] Make `AgentCommandService.stop()` idempotent.
- [ ] Stop new inbox claims first.
- [ ] Await any currently processing command before stopping the fact outbox.
- [ ] Flush pending durable facts before closing the outbox database.
- [ ] Ensure a command cannot be acknowledged after its stopped fact was lost
      due to shutdown ordering.
- [ ] Preserve the daemon shutdown watchdog as the final safety boundary, but
      do not rely on it for normal agent-command cleanup.

Acceptance gate:

- [ ] A shutdown during process-manager stop waits for the command to finish.
- [ ] A shutdown during fact delivery flushes or leaves the fact durable for
      later recovery.
- [ ] Repeated `stop()` calls do not duplicate cleanup or close resources twice.

### 4. Simplify the operational inbox runtime

- [ ] Replace the local `AgentCommandBridge` type and helper functions with a
      service construction/start call.
- [ ] Retain only the `DaemonAgentCommandService` façade required by daemon
      composition; do not pass a separate consumer, inbox, or outbox handle.
- [ ] Delegate command-service shutdown to the service handle before closing
      unrelated operational resources.
- [ ] Keep operational signal watchers, room membership, operational read-model
      updates, and task-service registration in this runtime.
- [ ] Remove comments that describe the runtime as owning agent-command bridge
      shutdown or transport details.

Acceptance gate:

- [ ] The runtime coordinates services but does not implement agent-command
      transport behavior.
- [ ] Existing operational signal and task inbox behavior is unchanged.

### 5. Add service-level consumers of materialized state

- [ ] Add tests for `getState()` snapshots during each lifecycle transition.
- [ ] Add subscription tests for ordered, immutable state notifications.
- [ ] Add a diagnostic/logging integration that reads service state without
      reaching into inbox or outbox internals.
- [ ] Decide whether daemon health/observability should consume the state now or
      whether this plan only establishes the query surface.

### 6. Enforce the service boundary

- [ ] Define the allowed dependency direction:
      `daemon entry/composition → agent-command service → service ports`, with
      infrastructure adapters composed only inside the agent-command service
      composition layer.
- [ ] Treat the inbox and outbox as service-private transport components:
      no production caller outside the agent-command service may invoke
      `claimNext`, `acknowledge`, `renew`, `subscribe`, `append`, `flushNow`,
      `stopAll`, or equivalent transport operations directly.
- [ ] Add a repository-enforced import/dependency check preventing
      `operational-inbox-runtime.ts` and other daemon entry modules from
      importing `agent-command-inbox`, `agent-command-fact-outbox`,
      `agent-command-fact-send`, or `agent-command-inbox-consumer` directly.
- [ ] Prevent callers from receiving the raw inbox, consumer, outbox registry,
      or fact sender. Expose only the service lifecycle and read-only state
      interfaces.
- [ ] Keep the raw transport ports and adapter factories internal to the
      service composition boundary where practical; if they must remain
      exported for unit tests, enforce that export as test-only usage through
      the architectural check.
- [ ] Add a focused architectural test or static check that fails when the
      forbidden imports or bridge helper pattern is reintroduced.
- [ ] Document the ownership rule in the agent-command service README and link
      to this plan from the relevant daemon development guidance if needed.
- [ ] Include the boundary check in the normal CLI lint/typecheck or test
      command used by pre-push validation, rather than relying on manual PR
      review.

Acceptance gate:

- [ ] A new daemon entrypoint cannot construct the agent-command transport
      without deliberately changing the architectural check.
  - [ ] A new daemon service cannot directly call the agent-command inbox or
        outbox; it must use the agent-command service API.
  - [ ] Other components use only `DaemonAgentCommandService`; the domain
        command service and transport runtime are not public integration
        points.
- [ ] The only production construction path for the agent-command inbox,
      stopped-fact outbox, and fact sender is the agent-command service
      composition layer.

## Validation criteria

1. **Single ownership boundary**

   - [ ] Agent command inbox, command consumer, fact outbox, fact sender, and
         command shutdown ordering are owned by the agent-command service.
   - [ ] `operational-inbox-runtime.ts` contains no agent-command transport
         implementation details.
   - [ ] The service exposes a narrow lifecycle and read-only state contract.
   - [ ] A static or automated architectural check enforces the dependency
         direction and forbidden-import list.
   - [ ] The check covers direct transport calls as well as direct adapter
         imports and construction.

2. **Correct lifecycle behavior**

   - [ ] Startup subscribes before the initial drain so availability nudges are
         not lost.
   - [ ] In-flight processing is awaited before outbox shutdown.
   - [ ] Durable facts survive transient backend failures and daemon restarts.
   - [ ] Shutdown is idempotent and bounded by the existing daemon watchdog.

3. **Materialized state correctness**

   - [ ] State reflects active command, successful completion, partial failure,
         retry, degraded transport, and stopped status.
   - [ ] State is updated from service-owned events rather than by callers
         inspecting private consumer/outbox state.
   - [ ] State is explicitly documented as local/read-only and non-authoritative.

4. **Regression coverage**

   - [ ] Existing agent-command service and inbox-consumer tests continue to
         pass.
   - [ ] Composition tests prove adapters are created and disposed by the
         service.
   - [ ] Operational inbox runtime tests prove only service lifecycle methods
         are called for agent-command startup and shutdown.
   - [ ] CLI and backend typechecks pass.
   - [ ] Repository formatting, linting, and focused integration tests pass.

## Non-goals

- [ ] Do not merge task inbox ownership into the agent-command service.
- [ ] Do not move operational signal watchers or the operational read model in
      this first extraction.
- [ ] Do not make the local materialized state authoritative over Convex.
- [ ] Do not introduce a generic daemon transport framework before the service
      boundary is proven with this concrete use case.
