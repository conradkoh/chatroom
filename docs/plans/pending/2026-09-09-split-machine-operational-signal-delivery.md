# Split machine operational signal delivery

## Objective

Completely split the daemon-facing use of `chatroom_machineOperationalSignals` into multiple purpose-specific signal tables and inboxes.

The migration should reduce Convex subscription invalidation frequency by ensuring that a change in one operational concern invalidates only the subscribers that consume that concern.

The migration must preserve these user-visible behaviors:

- daemon agent state eventually reflects the current backend projection;
- role removal is propagated to the daemon;
- task/native delivery continues to react to relevant state changes through the
  daemon's role-scoped reconciliation coordinator;
- daemon restarts can rebuild state safely;
- chatroom and machine scoping remains isolated;
- signal delivery remains cursor-based, paginated, retryable, and acknowledgeable;
- no task content or full operational rows are placed in signal tables.

## Validation criteria

The migration is valid only if all of the following are true:

1. **Separate data model per daemon use case**

   Every materially different backend-delivered daemon use case has its own underlying data model and Convex subscription. At minimum, agent operational status, machine status/connectivity, task delivery state, and role removal must not share one broad invalidation table merely for implementation convenience. Stop/restart lifecycle remains an explicit daemon lifecycle trigger unless a backend-delivered state change is shown to require durable signal delivery.

   Validation:

   - [ ] Each backend-delivered daemon use case is mapped to exactly one primary signal table or an explicitly documented set of atomic tables.
   - [ ] Each backend-delivered use case has a separate Convex query/subscription endpoint.
   - [ ] A write for one use case does not invalidate subscriptions for unrelated use cases.
   - [ ] The daemon has a separate inbox and cursor for each use case.
   - [ ] Local lifecycle and restart triggers have explicit ownership and do not
         get modeled as a Convex inbox without a demonstrated durability need.

2. **High-frequency updates are isolated**

   High-frequency updates, especially daemon heartbeats, must have their own slim table and subscription dedicated only to that use case. Heartbeat traffic must not invalidate agent-status, task-delivery, stop-state, or other daemon subscriptions.

   Validation:

   - [ ] Heartbeat writes use a heartbeat-specific table/model.
   - [ ] Heartbeat payloads contain only the minimum liveness fields required by their consumer.
   - [ ] Heartbeat writes do not update broad operational signal tables.
   - [ ] Heartbeat subscription invalidations are measurable independently from lower-frequency state changes.

3. **No daemon polling except heartbeat**

   The daemon must use reactive Convex subscriptions or explicit one-shot reads for all backend state changes. Periodic backend polling, refresh loops, and repeated query calls intended to detect changes are prohibited. A bounded local safety reconciliation timer is allowed only when it operates on already-hydrated local state and does not query Convex.

   Validation:

   - [ ] The only recurring daemon loop that polls backend state is the daemon heartbeat.
   - [ ] Any local safety reconciliation timer is bounded, operates on local read
         models, and is documented as a recovery trigger rather than a state
         discovery mechanism.
   - [ ] Operational, task, lifecycle, connectivity, and membership changes are subscription-driven or triggered by an explicit command/one-shot read.
   - [ ] Reconnect logic resubscribes or performs a bounded bootstrap; it does not become a polling loop.
   - [ ] Tests or instrumentation prove that non-heartbeat query frequency is event-driven.

4. **Separate daemon endpoints and atomic projections**

   Endpoints used by the daemon must be separate from endpoints used by the webapp. Where the data has different consumers or invalidation characteristics, daemon endpoints should use separate underlying Convex tables. Related daemon tables must be updated atomically in the same Convex mutation when one logical write affects multiple projections.

   Validation:

   - [ ] Every daemon-facing query and mutation is identifiable separately from webapp-facing endpoints.
   - [ ] Daemon endpoints do not expose webapp-shaped queries solely for code reuse.
   - [ ] Daemon tables contain purpose-specific projections rather than broad webapp read models.
   - [ ] Multi-table daemon projections are written in one Convex mutation/transaction boundary.
   - [ ] Tests verify that a failed mutation cannot leave only a subset of the related daemon tables updated.
   - [ ] Endpoint ownership and table ownership are documented for future changes.

These criteria are release gates, not optional follow-up improvements. If a proposed design violates one of them, the plan must document the exception and obtain explicit approval before implementation proceeds.

## Current state

```text
many backend lifecycle/config/connectivity writers
        ↓
project-agent-operational-status
        ↓
chatroom_machineOperationalSignals
        ↓
one daemon operational inbox per (machineId, chatroomId)
        ↓
hydrate chatroom_agentRoleOperationalStatus
        ↓
apply local operational read model
        ↓
request role-scoped NativeDeliveryService reconciliation

task-status signals ──→ TaskService-owned task inbox/read model
                              ↓
                         same reconciliation coordinator

agent lifecycle / restart / bounded local safety trigger
                              ↓
                         same reconciliation coordinator
```

Current query and writer references:

- Query: `services/backend/convex/machines.ts::subscribeMachineOperationalSignalsSince`
- Signal table: `chatroom_machineOperationalSignals`
- Writer helper: `services/backend/src/domain/usecase/agent/write-machine-operational-signal.ts`
- Daemon inbox: `packages/cli/src/daemon/infrastructure/agent-operational/operational-inbox.ts`
- Runtime wiring: `packages/cli/src/daemon/entry/task-inbox-runtime.ts`

Current `master` ownership and delivery boundary:

- `task-inbox-runtime.ts` owns operational-signal bootstrap, room membership,
  operational inbox lifecycle, and operational read-model updates.
- `TaskService` owns the task-status inbox, task snapshot state, and task-signal
  cursor; it is not a second operational inbox.
- `NativeDeliveryService` owns role-scoped reconciliation. Operational updates
  call `requestReconcile({ source: 'operational-signal' })`; they do not process
  task snapshots directly.
- `NativeDeliveryService` also has a bounded local safety reconciliation timer.
  It reads the already-hydrated local snapshot state and does not poll Convex.

This boundary is part of the starting point for the migration. Splitting the
operational signal table must not recreate direct task-delivery logic inside the
operational inbox or couple the new operational inbox to the task inbox.

## Target architecture

The exact table names should be finalized during step 1, but the partition should be based on independent daemon use cases rather than backend call sites. A likely shape is:

```text
machine connectivity / availability signals
        → machine connectivity inbox

agent operational-state signals
        → agent operational inbox

backend-delivered stop/restart state signals, if required
        → lifecycle-state inbox

agent-role removal signals
        → removal inbox

stop/restart lifecycle events
        → explicit local coordinator trigger

operational inbox updates
        → operational read model
        → role-scoped delivery reconciliation

task inbox, lifecycle events, restart completion, and the bounded local safety
trigger
        → the same role-scoped delivery reconciliation
```

Each table/inbox must have:

- a machine/chatroom scope;
- a monotonic or cursor-orderable signal key;
- only the metadata needed to identify and hydrate the change;
- a purpose-specific compound index;
- a purpose-specific acknowledgement mutation or cleanup path;
- a daemon-side cursor persisted independently from the other inboxes.

Do not split solely by the current projection function. One projection function may write to multiple purpose-specific tables in a single mutation.

## Migration sequence

### 1. Create the new tables

- [ ] Inventory every current signal shape and classify it by daemon use case:
  - connectivity changes;
  - role operational-state changes;
  - backend-delivered stop/restart state changes, if any;
  - role removal;
  - any other signal currently sharing the old table.
- [ ] Confirm which daemon consumer needs each class of signal.
- [ ] Define the new schema tables and purpose-specific indexes.
- [ ] Define signal key and cursor semantics for each table.
- [ ] Decide whether keys must be globally ordered, machine-scoped, chatroom-scoped, or only ordered within one inbox.
- [ ] Add validators/types for each signal payload.
- [ ] Add generated Convex API output through the normal Convex generation workflow.
- [ ] Add focused schema/type tests for indexes, optional removal fields, and cursor fields.
- [ ] Add one-time backfill support if a daemon can be upgraded while old rows exist.
- [ ] Document retention and acknowledgement behavior for every table.
- [ ] Define the upgrade boundary for old daemons and whether each replacement
      inbox must bootstrap from the operational projection before consuming new
      signals.

Acceptance gate:

- [ ] New tables compile and can be queried by their intended scope.
- [ ] No existing runtime behavior has changed yet.

### 2. Build the respective daemon inboxes and wire in the use cases

- [ ] Extract shared inbox infrastructure from `operational-inbox.ts`:
  - subscription lifecycle;
  - cursor persistence;
  - page handling;
  - hydration loop;
  - retry/restart behavior;
  - abort handling;
  - acknowledgement handling;
  - observability hooks.
- [ ] Keep task-signal ownership in `TaskService`; share only generic cursor,
      retry, and persistence primitives where useful.
- [ ] Implement one inbox per new signal table/use case, plus explicit local
      lifecycle/restart triggers where no Convex signal is required.
- [ ] Add purpose-specific Convex queries equivalent to `subscribeMachineOperationalSignalsSince`.
- [ ] Add purpose-specific hydration queries where the payload is only a change notification.
- [ ] Add purpose-specific acknowledgement mutations.
- [ ] Keep all authorization checks machine-owner scoped and preserve chatroom isolation.
- [ ] Wire each inbox into the daemon runtime with independent cursors and lifecycle state.
- [ ] Route operational changes to the existing role-scoped
      `NativeDeliveryService.requestReconcile` boundary. The replacement
      operational inbox must not call task delivery processors directly.
- [ ] Ensure one signal type cannot accidentally advance another inbox’s cursor.
- [ ] Define ordering when multiple inboxes report changes for the same role.
- [ ] Make local read-model application idempotent when two inboxes report related changes.
- [ ] Add tests for:
  - empty pages;
  - pagination;
  - reconnect and restart;
  - acknowledgement retry;
  - removed roles;
  - multiple chatrooms on one machine;
  - simultaneous signals from multiple tables;
  - stale or missing hydrated rows.
- [ ] Add tests proving an operational signal requests reconciliation for the
      affected `(chatroomId, role)` and does not independently read or process
      task snapshots.
- [ ] Add an integration test that exercises the new inboxes against Convex tables.

Acceptance gate:

- [ ] New inboxes can receive and process test signals without the old inbox being involved.
- [ ] Existing task delivery and operational read-model behavior remains intact.

### 3. Delete the daemon operational inbox for `subscribeMachineOperationalSignalsSince`

- [ ] Remove the old `runOperationalInbox` subscription path from `task-inbox-runtime.ts`.
- [ ] Remove old operational cursor initialization, watcher state, and observer wiring.
- [ ] Remove old acknowledgement calls from the daemon runtime.
- [ ] Remove old inbox-specific local persistence keys from the daemon.
- [ ] Preserve any generic inbox infrastructure that is reused by the new inboxes.
- [ ] Add a test proving the daemon no longer subscribes to `api.machines.subscribeMachineOperationalSignalsSince`.
- [ ] Confirm the daemon still starts, refreshes room membership, and runs all replacement inboxes.
- [ ] Confirm task delivery remains owned by `TaskService` and its
      `NativeDeliveryService` coordinator after the operational inbox is removed.

Acceptance gate:

- [ ] No production daemon code calls `subscribeMachineOperationalSignalsSince`.
- [ ] No production daemon code calls `ackMachineOperationalSignals` for the old table.
- [ ] The daemon still processes every intended use case through the replacement inboxes.

### 4. Delete code that still depends on the old query/table, then verify

- [ ] Remove the old query and its argument builders/types.
- [ ] Remove the old acknowledgement mutation and helper.
- [ ] Remove the old operational inbox implementation if no shared code remains.
- [ ] Remove old observers, metrics, cursor types, and test fixtures.
- [ ] Remove any direct operational-inbox-to-task-processing path that predates
      `NativeDeliveryService.requestReconcile`; retain the coordinator and its
      task/lifecycle/restart trigger tests.
- [ ] Remove old integration tests and replace them with per-table tests.
- [ ] Search the entire repository for:
  - `subscribeMachineOperationalSignalsSince`;
  - `ackMachineOperationalSignals`;
  - `chatroom_machineOperationalSignals`;
  - `writeMachineOperationalSignal`;
  - old operational cursor names;
  - old inbox persistence keys.
- [ ] Add or update any missed call sites discovered by the search.
- [ ] Run typechecks for backend, webapp, and CLI.
- [ ] Run focused backend integration tests and CLI inbox tests.
- [ ] Run the full test suite.

Acceptance gate:

- [ ] No production code depends on the old query, mutation, helper, or daemon inbox.
- [ ] Typechecks and tests pass before changing backend writers.

### 5. Stop writing the old table and write the new tables instead

- [ ] Update the operational projection layer so each state change emits only to its intended new table(s).
- [ ] Replace the old `writeMachineOperationalSignal` helper with purpose-specific writers.
- [ ] Preserve the daemon boundary established on `master`: signal handling
      updates the operational read model and requests role reconciliation; it
      does not own task snapshot delivery or native injection.
- [ ] Update these projection paths deliberately rather than relying on generic fan-out:
  - `projectAgentOperationalStatusForRole`;
  - `projectAgentStopStateForRole`;
  - `projectAgentOperationalStatusForRoleRemoved`;
  - `projectDaemonConnectivityForMachine`;
  - chatroom and machine rebuilds;
  - migrations and cleanup rebuilds.
- [ ] Verify every external Convex mutation still produces the correct new signal class:
  - `updateDaemonStatus`;
  - `updateSpawnedAgent`;
  - `saveTeamAgentConfig`;
  - `clearAllSpawnedPids`;
  - daemon agent lifecycle events;
  - task/message/participant transitions;
  - stop command flows;
  - backfill and rebuild mutations.
- [ ] Verify each signal is written atomically with the operational projection update.
- [ ] Suppress unchanged-state writes where the old projection already did so.
- [ ] Add tests proving each writer produces only the expected table rows.
- [ ] Add tests proving unrelated inboxes are not invalidated by that writer.
- [ ] Add tests proving operational-signal delivery and task-signal delivery
      converge through the same role-scoped reconciliation coordinator without
      duplicate native injection.
- [ ] If a staged rollout requires dual-write temporarily, make it explicitly bounded and observable, then remove it before completion.

Acceptance gate:

- [ ] No production write inserts into `chatroom_machineOperationalSignals`.
- [ ] Every supported daemon use case receives its replacement signal.
- [ ] Convex invalidation behavior is narrower than the old shared table.

### 6. Delete the underlying table

- [ ] Confirm repository-wide search finds no schema, query, writer, test, migration, or generated reference to `chatroom_machineOperationalSignals`.
- [ ] Confirm no deployment still runs an old daemon binary that requires the table, or define the supported upgrade boundary.
- [ ] Remove the table from `services/backend/convex/schema.ts`.
- [ ] Remove obsolete indexes and validators.
- [ ] Add a migration/cleanup step only if production data deletion is required by the deployment process.
- [ ] Do not delete unrelated operational projection tables; they remain the source of truth for hydration/bootstrap.
- [ ] Verify Convex deployment/schema validation succeeds.

Acceptance gate:

- [ ] The old table is absent from the schema and production code.
- [ ] New daemon binaries operate without the old table.
- [ ] Existing operational projections remain readable and writable.

### 7. Final typecheck and test verification

- [ ] Run backend typecheck.
- [ ] Run webapp typecheck.
- [ ] Run CLI typecheck.
- [ ] Run focused signal/inbox unit tests.
- [ ] Run backend machine operational-signal integration tests.
- [ ] Run daemon task-inbox/runtime tests.
- [ ] Run the full repository test suite.
- [ ] Run lint and formatting checks.
- [ ] Run a repository-wide search for stale identifiers and old table names.
- [ ] Verify a fresh daemon startup bootstraps current operational state.
- [ ] Verify reconnect and cursor recovery for every new inbox.
- [ ] Verify role removal, daemon connectivity changes, stop-state changes, and ordinary role-state changes independently.
- [ ] Verify two chatrooms on the same machine remain isolated.
- [ ] Verify acknowledgement failure causes retry without losing state.
- [ ] Verify no end-user-facing task or agent status flow regresses.
- [ ] Verify the bounded local safety reconciliation trigger remains local-state
      based and is not converted into a backend polling loop.

## Rollback and safety considerations

- Keep the existing operational projection tables as the source of truth throughout the migration.
- Prefer additive schema changes until the old daemon inbox is removed and replacement inboxes are proven.
- Make each new inbox independently disableable if feature flags are available.
- Do not make the daemon depend on signal history for permanent state; restart/bootstrap must always reconstruct current state.
- Treat signal rows as delivery metadata, not durable business state.
- During rollout, monitor signal insert rates, subscription invalidations, inbox lag, hydration failures, acknowledgement failures, and stale cursor recovery.

## Completion definition

The migration is complete when:

```text
purpose-specific backend projections
        ↓
purpose-specific signal tables
        ↓
purpose-specific daemon inboxes
        ↓
independent cursors and acknowledgements
        ↓
same user-visible operational behavior
        + lower unrelated subscription invalidation
```

The old `subscribeMachineOperationalSignalsSince` query, daemon inbox, acknowledgement path, writer, table, schema entry, and tests must all be removed, with typechecks and tests passing.
