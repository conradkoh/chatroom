# Split daemon task-status signal delivery

## Objective

Separate the daemon’s task-delivery signal path from the webapp’s chatroom timeline task-status path.

The current implementation already has two tables, but the daemon endpoint is still defined in `messageList.ts`, and task-status writes share a common writer that fans out to both webapp and daemon projections. This plan makes the daemon task-delivery model, endpoint, inbox, cursor, hydration path, and acknowledgement lifecycle explicit and independently evolvable.

The migration must preserve these user-visible behaviors:

- assigned tasks continue to reach the correct daemon and role;
- task reassignment, completion, closure, and status transitions remain observable;
- task content remains outside the reactive signal payload;
- webapp timeline updates continue independently;
- daemon restart and reconnect recover the current assigned-task snapshot;
- machine and chatroom scopes remain isolated;
- signal delivery remains cursor-based, paginated, retryable, and acknowledgeable where applicable.

## Validation criteria

The migration is valid only if all of the following are true:

1. **Separate data model per daemon use case**

   Daemon task discovery/delivery must use a daemon-owned data model and subscription, separate from the webapp timeline task-status model. A task-status transition may update both projections, but the projections must have independent schemas, indexes, invalidation behavior, and consumers.

   Validation:

   - [x] The daemon task-delivery use case has one clearly identified primary signal table: `chatroom_machineTaskDeliverySignals`.
   - [x] The webapp timeline continues to use `chatroom_timelineTaskStatusSignals` independently.
   - [x] The daemon subscription does not read the webapp timeline table.
   - [ ] A webapp-only timeline write does not invalidate daemon task-delivery subscriptions.
   - [ ] A daemon task-delivery write does not invalidate unrelated operational or heartbeat subscriptions.

2. **High-frequency updates are isolated**

   Task-status signal delivery must not become a general-purpose heartbeat or liveness channel. High-frequency machine heartbeat writes must remain in their own heartbeat model and subscription.

   Validation:

   - [ ] Heartbeat writes do not update task-status signal tables.
   - [x] Task signal payloads contain only task routing/status metadata needed by the daemon.
   - [ ] Task signal invalidation rate can be measured independently from heartbeat traffic.

3. **No daemon polling except heartbeat**

   The daemon must use the task-status subscription and explicit hydration reads. It must not periodically poll task lists to discover changes.

   Validation:

   - [x] `runTaskInbox` is subscription-driven.
   - [ ] Reconnect logic resubscribes or performs a bounded snapshot bootstrap.
   - [x] The only recurring daemon polling loop remains the daemon heartbeat.
   - [x] No replacement implementation introduces a timer-based task refresh loop.

4. **Separate daemon endpoints and atomic projections**

   Daemon task-delivery endpoints must be separate from webapp message/timeline endpoints. When one task transition updates both webapp and daemon projections, both writes must occur atomically inside the same Convex mutation.

   Validation:

   - [x] The daemon subscription endpoint is defined in a daemon/task-oriented Convex module, not `messageList.ts`.
   - [x] The daemon hydration endpoint is separate from webapp task/message queries.
   - [x] The daemon acknowledgement/cleanup endpoint is separate from webapp timeline APIs.
   - [x] Task transition writes update the timeline and daemon projections atomically.
   - [x] Tests prove that a failed mutation cannot leave only one projection updated.

These criteria are release gates. Any exception must be documented and explicitly approved before implementation proceeds.

## Current state

```text
task create / transition / reassignment
        ↓
writeTimelineTaskStatusSignal
        ├── chatroom_timelineTaskStatusSignals
        │       └── webapp task-status/timeline consumers
        └── chatroom_machineTaskStatusSignals
                └── messageList.subscribeTaskStatusSignalsSince
                        └── daemon task inbox
                                └── hydrate assigned-task snapshots
```

Relevant current code:

- Daemon subscription: `services/backend/convex/messageList.ts::subscribeTaskStatusSignalsSince`
- Daemon signal table: `chatroom_machineTaskStatusSignals`
- Webapp timeline table: `chatroom_timelineTaskStatusSignals`
- Shared writer: `src/domain/usecase/task/write-timeline-task-status-signal.ts`
- Daemon inbox: `packages/cli/src/daemon/infrastructure/inbox/task.ts`
- Daemon task service: `packages/cli/src/daemon/services/task-service/service/task-service.ts`
- Daemon hydration query: `services/backend/convex/tasks.ts::listTasksForMachineSignalRange`
- Hydration projection: `chatroom_machineAssignedTaskSnapshots`
- Per-machine signal head: `chatroom_machineTaskStatusSignalHeads`

## Target architecture

```text
task transition mutation
        ├── webapp timeline projection
        │       └── chatroom_timelineTaskStatusSignals
        │               └── webapp timeline endpoint(s)
        │
        └── daemon task-delivery projection
                └── chatroom_machineTaskDeliverySignals
                        └── daemon task-delivery subscription
                                └── assigned-task snapshot hydration
                                        └── native task delivery
```

The target table name is provisional. Final naming should make the consumer and purpose obvious. The daemon table should contain only:

- machine ID;
- chatroom ID;
- task ID;
- target role;
- task status;
- cursor/order key;
- task update timestamp;
- any minimal delivery revision required for deduplication.

The full task row and task content remain in existing task/snapshot projections and are loaded imperatively after a signal arrives.

## Migration sequence

### 1. Create the new daemon task-delivery table and endpoints

- [x] Inventory all task transitions that call `writeTimelineTaskStatusSignal`.
- [x] Confirm the daemon use cases: task discovery, assigned-task snapshot refresh, task removal from local state, and native task delivery.
- [x] Define the new daemon-owned signal table and compound indexes for `(machineId, chatroomId, signalKey)` and any required machine-wide frontier.
- [x] Decide that the append-only task-delivery table replaces the old machine signal head; no new head table is required.
- [x] Define cursor semantics and ordering for task transitions with equal timestamps.
- [x] Add validators and types for the daemon task-delivery signal.
- [x] Add a daemon-owned subscription query outside `messageList.ts`.
- [x] Add a daemon-owned hydration query outside webapp message APIs.
- [x] Add a daemon-owned acknowledgement/cleanup path if retention requires deletion.
- [x] Preserve `chatroom_timelineTaskStatusSignals` and its webapp consumers unchanged.
- [x] Add schema/type tests for routing, role, status, cursor, and machine/chatroom indexes.
- [ ] Add migration/backfill support if upgraded daemons must consume pre-cutover task state.

Acceptance gate:

- [x] New daemon task-delivery schema and endpoints compile.
- [x] Webapp timeline behavior remains unchanged.
- [x] Replacement schema/endpoints and tests passed before the production writer was switched.

### 2. Build the daemon task-delivery inbox and wire in the use cases

- [ ] Adapt or extract shared cursor-subscription infrastructure from `infrastructure/inbox/task.ts`.
- [ ] Implement the new daemon task-delivery inbox with:
  - subscription lifecycle;
  - per-machine/chatroom cursor persistence;
  - bounded pages;
  - reconnect/backoff behavior;
  - imperative snapshot hydration;
  - idempotent local snapshot application;
  - acknowledgement/cleanup if applicable.
- [ ] Keep task content out of the reactive subscription payload.
- [ ] Wire the inbox into `task-service.ts` without introducing polling.
- [ ] Preserve initial `chatroom_machineAssignedTaskSnapshots` bootstrap.
- [ ] Define behavior when a signal references a task that is completed, deleted, reassigned, or no longer present in the snapshot projection.
- [ ] Define ordering when multiple task signals arrive for one task and role.
- [ ] Add tests for:
  - task creation;
  - assignment and reassignment;
  - status transitions;
  - completion/closure removal;
  - pagination;
  - reconnect and restart;
  - multiple chatrooms on one machine;
  - duplicate or out-of-order signals;
  - missing hydration rows;
  - acknowledgement retry.

Acceptance gate:

- [x] The new inbox can deliver task updates without reading the old daemon endpoint.
- [x] Native task delivery behavior remains intact.
- [x] No daemon polling loop is added.

### 3. Delete daemon usage of `messageList.subscribeTaskStatusSignalsSince`

- [x] Remove the old subscription call from `packages/cli/src/daemon/infrastructure/inbox/task.ts`.
- [x] Remove the old task-signal contract types and argument builder.
- [x] Remove old endpoint-specific cursor and observer wiring.
- [x] Remove any old persistence keys that identify the `messageList` task signal feed.
- [x] Preserve reusable cursor/inbox primitives used by the replacement inbox.
- [x] Add a test proving the production daemon no longer calls `api.messageList.subscribeTaskStatusSignalsSince`.
- [x] Confirm the task service starts and maintains the replacement inbox for every active chatroom.

Acceptance gate:

- [x] No production daemon code subscribes to the `messageList` task-status endpoint.
- [x] Task delivery is fully served by the daemon-owned endpoint/inbox.

### 4. Delete code that still depends on the old daemon task-status endpoint/table, then verify

- [x] Remove `subscribeTaskStatusSignalsSince` from `messageList.ts` after all daemon references are gone.
- [x] Remove old endpoint-specific tests and replace them with daemon endpoint tests.
- [x] Remove old daemon signal contract names and imports from production endpoint/use-case code.
- [ ] Search the repository for:
  - `subscribeTaskStatusSignalsSince`;
  - `chatroom_machineTaskStatusSignals`;
  - old task signal argument builders;
  - old task inbox cursor/persistence names.
- [x] Distinguish and preserve legitimate schema, head-table, and historical migration references until the migration is retired.
- [x] Confirm webapp references use `chatroom_timelineTaskStatusSignals` and are not accidentally removed.
- [x] Run backend, webapp, and CLI typechecks (`pnpm typecheck`, 5/5 packages).
- [x] Run focused task inbox, task service, message-list, and integration tests (backend cleanup slice: 7 files, 60 tests).
- [x] Run the full backend suite (299 files, 1,984 tests); the prior writer cutover pre-push also passed the repository checks.

Acceptance gate:

- [x] No production daemon code depends on the old `messageList` endpoint.
- [x] The webapp timeline path still works through its own projection.
- [x] Typechecks and tests pass for the endpoint-removal boundary before proceeding to schema/migration retirement.

### 5. Stop writing the old daemon table and write the new table instead

- [x] Replace the daemon branch of `writeTimelineTaskStatusSignal` with a purpose-specific daemon task-delivery writer.
- [x] Keep the webapp timeline branch writing `chatroom_timelineTaskStatusSignals`.
- [x] Ensure both projections are written atomically from task create/transition mutations.
- [x] Update task reassignment and agent-exit release paths that explicitly emit task signals.
- [ ] Update any migration or backfill code that writes `chatroom_machineTaskStatusSignals`.
- [ ] Revisit the machine signal head logic and make it consistent with the new daemon table.
  - [x] Verify routing is resolved from the current team/machine configuration before writing a daemon signal.
  - [x] Verify task transitions without a remote machine do not create daemon delivery rows.
  - [x] Add tests proving:
    - timeline-only writes do not create daemon rows;
    - daemon-routed writes create only the expected daemon row and no legacy head;
    - both projections receive the same task transition atomically;
  - reassignment creates the correct old/new machine behavior;
  - unrelated machines and chatrooms are not invalidated.
  - [x] No temporary dual-write was required.

Acceptance gate:

- [x] No production write inserts into `chatroom_machineTaskStatusSignals`.
- [x] Every daemon task-delivery use case receives the new signal.
- [x] Webapp timeline task-status updates remain intact.

### 6. Delete the old daemon task-status table

- [ ] Confirm repository-wide search finds no production schema, query, writer, test, migration, or generated reference to `chatroom_machineTaskStatusSignals`.
- [ ] Confirm no supported daemon binary still requires the old table.
- [ ] Remove `chatroom_machineTaskStatusSignals` from `services/backend/convex/schema.ts`.
- [ ] Remove or rename obsolete head-table code if it is still tied to the old signal table.
- [ ] Retain `chatroom_timelineTaskStatusSignals` for webapp timeline behavior.
- [ ] Retain `chatroom_machineAssignedTaskSnapshots` as the daemon hydration/read model.
- [ ] Add production data cleanup only if required by the deployment process.
- [ ] Verify Convex schema/deployment validation succeeds.

Acceptance gate:

- [ ] The old daemon table and endpoint are absent from production code.
- [ ] The webapp timeline table remains available.
- [ ] New daemon binaries operate using only the new task-delivery model.

### 7. Final typecheck and test verification

- [ ] Run backend typecheck.
- [ ] Run webapp typecheck.
- [ ] Run CLI typecheck.
- [ ] Run task inbox and task service unit tests.
- [ ] Run message-list and task-transition backend tests.
- [ ] Run integration tests for task delivery, assignment, reassignment, completion, and restart recovery.
- [ ] Run the full repository test suite.
- [ ] Run lint and formatting checks.
- [ ] Search for stale endpoint/table/writer identifiers.
- [ ] Verify a fresh daemon bootstraps assigned-task snapshots correctly.
- [ ] Verify reconnect/cursor recovery for every active chatroom.
- [ ] Verify no task polling exists outside heartbeat handling.
- [ ] Verify webapp timeline updates and daemon task delivery remain independent.
- [ ] Verify a failed multi-projection task mutation does not leave partial daemon/webapp signal state.
- [ ] Verify user-visible task delivery and chatroom timeline behavior has not regressed.

## Rollback and safety considerations

- Keep `chatroom_tasks` and `chatroom_machineAssignedTaskSnapshots` as the durable/current-state sources of truth.
- Treat task signal rows as delivery metadata, not business state.
- Prefer additive schema and endpoint changes until the replacement inbox is proven.
- Do not make the daemon depend on historical signal rows for permanent state; startup bootstrap must reconstruct current assignments.
- Monitor task signal insert rates, subscription invalidations, inbox lag, hydration failures, cursor recovery, and delivery failures.
- Document the daemon binary upgrade boundary before removing the old table.

## Completion definition

The migration is complete when:

```text
task transition mutation
        ├── webapp timeline projection + endpoint
        └── daemon task-delivery projection + endpoint
                ↓
        daemon task inbox
                ↓
        assigned-task snapshot hydration
                ↓
        native task delivery
```

The old `messageList.subscribeTaskStatusSignalsSince` daemon path, old machine task signal table, old writer branch, and obsolete tests must be removed. Webapp timeline task-status delivery must remain functional, and all typechecks and tests must pass.
