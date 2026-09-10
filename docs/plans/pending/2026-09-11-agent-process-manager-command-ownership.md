# Move agent command inbox ownership into the agent process manager service

## Objective

Make `AgentProcessManagerService` the single daemon-facing owner of the
dedicated agent stop-command transport.

The service should own the complete internal flow:

```text
agent process manager service
  ├── dedicated agent.stop inbox
  ├── inbox claim / lease / acknowledgement
  ├── stop-command execution
  ├── stopped-fact outbox and delivery
  └── command transport lifecycle state
```

Other daemon components should use the agent process manager service boundary
for the operations they need. They must not read, claim, acknowledge, renew,
or otherwise interact with the dedicated inbox directly.

This is intentionally narrower than introducing a separate aggregate agent
runtime. The dedicated inbox currently carries only `agent.stop` commands;
its purpose is to stop local agent processes and report the resulting facts
back to the backend. The inbox payload, lease protocol, and fact transport are
therefore internal implementation details of the process manager service.

## Design principles

- `AgentProcessManagerService` is the only public daemon service boundary for
  agent process commands and the dedicated agent stop transport.
- The service owns the local materialized command state needed for lifecycle
  and diagnostics. Callers do not assemble a snapshot by querying the inbox,
  outbox, and process manager separately.
- The backend remains authoritative for durable stop-command projections,
  lifecycle revisions, target status, and completion state.
- The dedicated `agent.stop` inbox is distinct from the generic machine
  command inbox, which continues to handle unrelated commands such as ping,
  git refresh, local actions, and legacy start/restart event handling until
  those flows are migrated separately.
- The migration must proceed through a usable service boundary before the old
  command-service implementation is removed.

## Current state

The dedicated agent command transport is exposed as a separate
`DaemonAgentCommandService` and is started from
`operational-inbox-runtime.ts`. The process manager is passed into that
service as a dependency, while other daemon callers use a mixture of:

- `DaemonAgentProcessManagerService` for Effect-wrapped process operations;
- `DaemonAgentProcessManagerCommandService` for the raw queue-backed process
  manager API; and
- `DaemonAgentCommandService` for starting and stopping the dedicated inbox
  runtime.

This creates two problems:

1. callers must know which service/tag to use for related agent operations;
2. the process manager state and dedicated command transport state have no
   single owner or callable boundary.

Relevant implementation areas include:

- `packages/cli/src/daemon/services/agent-process-service/service/agent-process-manager-service.ts`
- `packages/cli/src/daemon/services/agent-command-service/`
- `packages/cli/src/daemon/infrastructure/convex/agent-command-inbox.ts`
- `packages/cli/src/daemon/infrastructure/outbox/agent-command-fact-outbox.ts`
- `packages/cli/src/daemon/infrastructure/outbox/agent-command-fact-send.ts`
- `packages/cli/src/daemon/entry/operational-inbox-runtime.ts`
- `packages/cli/src/daemon/entry/daemon-services.ts`

## Target public boundary

Extend `AgentProcessManagerService` with the externally supported methods
needed by current callers. The exact names should follow the existing service
conventions, but the boundary should cover these responsibilities:

```ts
interface AgentProcessManagerService {
  start(): Promise<void>;
  stop(): Promise<void>;

  // Existing process operations remain on this service.
  startAgent(...): Promise<...>;
  stopAgent(...): Promise<...>;
  restartAgent(...): Promise<...>;
  runSerializedForAgent(...): Promise<...>;

  // New service-owned transport lifecycle and read model.
  startCommandProcessing(): Promise<void>;
  stopCommandProcessing(): Promise<void>;
  getCommandState(): AgentCommandState;
  subscribeCommandState(listener: (state: AgentCommandState) => void): () => void;
}
```

The final API may use different names if the existing process-manager service
already has a compatible lifecycle vocabulary. The important requirements are:

- one canonical service/tag;
- no caller needs the raw `DaemonAgentProcessManagerCommandService` tag;
- no caller needs the separate `DaemonAgentCommandService` tag;
- command transport lifecycle and state are exposed only through the process
  manager service;
- inbox commands are not exposed through the public interface.

`getCommandState()` is for daemon lifecycle, diagnostics, and tests. It is not
an API for other components to consume or manipulate inbox commands.

## Implementation sequence

### 1. Add the new external-facing methods to the agent process manager boundary

- [ ] Define the command-processing lifecycle methods on the canonical
      `AgentProcessManagerService` interface.
- [ ] Define a read-only immutable command-processing state snapshot covering
      startup, running, stopping, stopped, degraded, active command
      correlation, processed/failed counts, and the last transport error or
      fact timestamp where those values are already supported.
- [ ] Add the state query and subscription methods only if they are needed by
      current daemon lifecycle/diagnostic callers; do not expose inbox or
      outbox ports.
- [ ] Update the Effect service shape/tag so the canonical service can be
      requested from daemon entrypoints without a second command-service tag.
- [ ] Keep the implementation temporarily backed by the existing command
      service where necessary. This phase is contract-first and must not yet
      delete the old implementation.
- [ ] Add focused contract tests proving the new methods are available and
      that returned snapshots are immutable copies.

Acceptance gate:

- [ ] The process manager service has a complete caller-facing contract for
      process operations plus command-processing lifecycle.
- [ ] No new caller needs to import `DaemonAgentCommandService` to use the
      new boundary.

### 2. Migrate all callers and validate safe decoupling

Migrate callers before moving implementation ownership. This proves that the
old command service is no longer needed as an integration point.

- [ ] Migrate `operational-inbox-runtime.ts` to start and stop command
      processing through `AgentProcessManagerService`.
- [ ] Migrate daemon startup and shutdown composition to provide and supervise
      only the canonical process manager service.
- [ ] Migrate lifecycle callers currently using
      `DaemonAgentProcessManagerCommandService` to the canonical service
      boundary, including start, restart, stop, shutdown, native delivery,
      and serialized execution paths.
- [ ] Remove the transitional `DaemonAgentProcessManagerCommandService` tag
      from caller dependency unions and Effect requirements.
- [ ] Remove production callers of `DaemonAgentCommandService`, leaving only
      temporary compatibility wiring if required by tests during the
      migration.
- [ ] Search the repository to verify that production code no longer imports
      the old command service as an integration dependency.
- [ ] Run the focused CLI tests and typecheck after each caller group, then
      run the full CLI test/typecheck suites before proceeding.
- [ ] Add or update architectural tests so a new caller cannot reintroduce a
      second process-manager command tag or call the dedicated transport
      directly.

Acceptance gate:

- [ ] All production callers compile and pass tests using only the canonical
      `AgentProcessManagerService` boundary.
- [ ] `DaemonAgentCommandService` is no longer required to coordinate daemon
      behavior from outside the process manager service.
- [ ] The old command-service implementation can be replaced internally
      without changing callers.

### 3. Implement the inbox and transport internals inside the process manager service

- [ ] Move or recreate dedicated `agent.stop` inbox construction inside the
      process manager service composition.
- [ ] Move or recreate the inbox consumer inside the service implementation,
      preserving claim, lease renewal, acknowledgement, retry, and shutdown
      behavior.
- [ ] Move or recreate stopped-fact outbox construction and Convex fact
      sending inside the service implementation.
- [ ] Make the service compose the domain stop use case with its own process
      manager operations rather than injecting the process manager into a
      separate public command service.
- [ ] Fold command-processing state transitions into the process manager
      service's materialized state and publish immutable snapshots through the
      new boundary.
- [ ] Preserve the required ordering:
  - stop accepting new claims;
  - finish the in-flight stop command;
  - preserve or flush durable stopped facts;
  - acknowledge only after fact delivery is safely handed off;
  - close transport resources.
- [ ] Preserve idempotent handling of absent targets, partial failures,
      expired commands, duplicate facts, and repeated shutdown calls.
- [ ] Keep Convex authorization and backend projection semantics unchanged.
- [ ] Keep raw inbox, consumer, outbox, and fact-sender objects private to the
      service composition. Do not return them from the service or its Effect
      layer.
- [ ] Add service-level tests for startup, command processing, partial
      failure, lease renewal, fact delivery, degraded state, and shutdown
      races.

Acceptance gate:

- [ ] The canonical process manager service can start and stop the dedicated
      agent stop transport without any external bridge or command-service
      runtime handle.
- [ ] Existing inbox/outbox reliability and backend lifecycle projections are
      unchanged.
- [ ] The service's materialized command state is the only local command
      state exposed to daemon callers.

### 4. Delete the old agent command service code

- [ ] Delete the old `agent-command-service` package once all behavior has
      moved and its tests have been transferred or replaced.
- [ ] Delete `DaemonAgentCommandService` and
      `DaemonAgentCommandServiceLive` from daemon service composition.
- [ ] Delete `DaemonAgentProcessManagerCommandService` and its live layer.
- [ ] Remove obsolete command-service imports, dependency unions, adapter
      exports, compatibility types, and temporary comments.
- [ ] Move or delete infrastructure files according to the final ownership
      boundary; files retained under `infrastructure/` must only be reachable
      from process-manager service composition.
- [ ] Update service documentation and this plan to describe the canonical
      ownership model.
- [ ] Run repository-wide searches for the deleted service names and dedicated
      inbox calls.
- [ ] Run the full CLI, backend, and affected webapp validation suites, plus
      typechecks and the architectural boundary check.

Final acceptance criteria:

- [ ] `AgentProcessManagerService` is the only daemon-facing service for agent
      process commands and the dedicated `agent.stop` transport.
- [ ] No production component outside that service can directly call the
      dedicated inbox or stopped-fact outbox.
- [ ] No caller needs to combine process-manager state with command-service
      state to understand agent command processing.
- [ ] The dedicated inbox remains an internal mechanism for stopping agent
      processes and reporting stopped facts.
- [ ] Generic machine command handling remains unchanged unless explicitly
      migrated by a separate plan.
- [ ] All existing stop-command correctness, durability, retry, and shutdown
      guarantees remain covered by tests.
