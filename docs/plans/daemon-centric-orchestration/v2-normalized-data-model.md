# V2 Normalized Orchestration Data Model

**Status:** Proposal — no production schema changes are included in this document.

**Scope:** Task assignment, agent configuration/runtime, participant presence, and machine-directed command delivery.

## Recommendation

I would build a v2 boundary, but I would not copy `chatroom_machineAssignedTaskSnapshots` into a table with a new suffix. That would preserve the problem under a new name.

The current snapshot is a write-time join of four different owners:

- `chatroom_tasks` owns task content and queue lifecycle.
- `chatroom_teamAgentConfigs` owns the desired configuration for a chatroom role.
- `chatroom_participants` owns connection and presence state.
- `chatroom_machines` owns machine identity and ownership.

The resulting `chatroom_machineAssignedTaskSnapshots` row repeats task, configuration, and participant fields once for every machine/task/role combination. A participant heartbeat or configuration change therefore fans out across all matching task rows. The row is a useful read model, but it should not be the canonical data model.

The v2 design should have:

1. One canonical row per domain entity.
2. Separate current state from append-only history.
3. Separate durable commands from facts/events.
4. A single monotonic machine feed cursor instead of timestamp-derived cursors per projection.
5. Read models built from those entities, rather than write-time denormalized joins.

The long-term ownership should follow the existing daemon-centric orchestration plan: the daemon owns high-churn orchestration locally, while Convex stores normalized projections needed by the webapp and cross-machine views. If Convex remains the authority during an intermediate phase, the same model still works; the ownership changes, not the table boundaries.

## What I would change from the current model

| Current design                                                                             | V2 design                                                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| One snapshot row contains task, config, runtime, and presence fields                       | Separate task state, assignment, agent config, runtime, and presence rows                |
| Participant heartbeat patches every assigned-task row                                      | Heartbeat patches one presence row and emits one compact feed event                      |
| `assignedTo`, `parentTaskIds`, and `attachedTaskIds` are embedded or array fields          | Assignments, dependencies, and attachments are explicit relationship rows                |
| `chatroom_eventStream` mixes commands, lifecycle facts, UI events, and deprecated variants | Durable machine commands and typed domain facts have separate tables and retention rules |
| Cursor ordering is derived from timestamps and composite strings                           | Each machine has a monotonic sequence allocated at write time                            |
| Full snapshot hydration is required to discover current state                              | Hydrate normalized current-state rows once; consume compact events thereafter            |
| Runtime PID/circuit state is stored with desired agent configuration                       | Desired config and observed runtime are separate records                                 |

## Proposed v2 tables

These names are intentionally explicit. The suffix is a migration boundary, not a license to retain legacy fields.

### Task domain

#### `chatroom_tasksV2`

One row per task. Keep relatively stable task identity and content here:

```text
chatroomId
createdBy
content
sourceMessageId?
createdAt
```

Do not put current status, assignment, queue position, or denormalized backlog fields here. Content is not high-churn, so it does not need its own table in the first version.

#### `chatroom_taskStatesV2`

Exactly one current-state row per task:

```text
taskId
status                 // pending | acknowledged | in_progress | completed | cancelled
queuePosition?
version                // incremented on every state change
acknowledgedAt?
startedAt?
completedAt?
updatedAt
```

The state row is the source for current queue queries. `version` is an application-level optimistic-concurrency and feed field; `_creationTime` is not a domain version.

#### `chatroom_taskAssignmentsV2`

One row per assignment attempt, not one row per task snapshot:

```text
taskId
agentSlotId
attempt
state                  // offered | acknowledged | active | released | completed | failed
sessionAugmentation    // none | new_session
offeredAt?
acknowledgedAt?
startedAt?
completedAt?
releasedAt?
updatedAt
```

This makes retries and reassignment explicit. `assignedTo` stops being an ambiguous string on the task row. If a task can only have one active assignment, enforce that invariant in the mutation while still retaining historical attempts.

#### `chatroom_taskTransitionsV2`

Append-only lifecycle history:

```text
taskId
sequence              // per-task sequence
fromStatus?
toStatus
reason?
actorType
actorId?
occurredAt
```

This replaces the task-status subset of the large event union for timeline/history use cases. It is not used as the daemon command queue.

#### `chatroom_taskDependenciesV2` and `chatroom_taskAttachmentsV2`

Use one row per relationship:

```text
chatroom_taskDependenciesV2: taskId, dependsOnTaskId, relation, createdAt
chatroom_taskAttachmentsV2:  taskId, attachedTaskId, position, createdAt
```

These replace `parentTaskIds` and `attachedTaskIds`. Arrays are convenient for writes but make partial updates, reverse lookups, and uniqueness difficult.

### Agent domain

#### `chatroom_agentSlotsV2`

One stable row per chatroom role:

```text
chatroomId
teamId?
role                 // normalized lower-case role key
machineId?
agentType            // custom | remote
createdAt
updatedAt
```

This is the identity/binding row. It should not contain PID, heartbeat, circuit state, or model lists.

#### `chatroom_agentConfigsV2`

One current desired-configuration row per slot:

```text
agentSlotId
agentHarness
model?
workingDir?
desiredState          // running | stopped
configVersion
updatedAt
```

Configuration history can be added later if audit requirements justify it. The current row should be the only input to restart decisions.

#### `chatroom_agentRuntimeV2`

One observed-runtime row per slot:

```text
agentSlotId
runtimeState          // idle | starting | running | stopping | exited
spawnedAgentPid?
circuitState          // closed | open | half-open
harnessSessionId?
startedAt?
lastExitAt?
updatedAt
```

This is written by the daemon/process manager. A runtime update must not invalidate configuration or task lists.

#### `chatroom_agentPresenceV2`

One row per slot, not one row per assigned task:

```text
agentSlotId
connectionId?
lastSeenAt?
lastSeenAction?
turnPhase?
lastInFlightTaskId?
presenceVersion
updatedAt
```

Presence is a property of the participant/agent slot. It should never be copied into every task assignment row. The task monitor can associate presence with an assignment by reading the slot ID locally.

### Machine delivery and feeds

#### `chatroom_machineCommandsV2`

Commands are durable work addressed to one machine. They are not general event-stream facts:

```text
machineId
commandType
targetAgentSlotId?
targetWorkspaceId?
payload                 // tagged union specific to commandType
status                  // pending | in_progress | completed | failed | expired
idempotencyKey
createdAt
expiresAt?
claimedAt?
completedAt?
errorMessage?
```

Index it by `[machineId, status, createdAt]` or by a machine sequence. A daemon can claim a command exactly once and report an outcome without scanning unrelated lifecycle events. The existing command-run V2 split between run metadata, live tail, and output is a good pattern to preserve.

#### `chatroom_machineEventsV2`

Facts that consumers may replay, separate from commands:

```text
machineId
chatroomId?
sequence                // strictly increasing per machine
aggregateType           // task | assignment | agent | presence | command
aggregateId
eventType
payloadVersion
payload                 // compact, typed event payload; never a full snapshot
occurredAt
```

Examples include `task.state_changed`, `assignment.offered`, `agent.runtime_changed`, and `presence.changed`. The event payload should contain the fields needed to update a local read model, not a copy of every joined entity. Historical event payloads must remain parseable after current-state schemas evolve.

#### `chatroom_machineFeedCursorsV2`

One row per machine:

```text
machineId
nextSequence
updatedAt
```

Allocate `sequence` in the same serializable mutation that appends a machine event. Convex does not provide unique indexes, so the implementation must use a deterministic machine key and a single counter row. A cursor is then a correctness primitive, not a best-effort timestamp.

## Indexes and invariants

Recommended indexes:

| Table                           | Indexes                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `chatroom_tasksV2`              | `by_chatroom_createdAt`, `by_sourceMessage`              |
| `chatroom_taskStatesV2`         | `by_taskId`, `by_chatroom_status_queue`                  |
| `chatroom_taskAssignmentsV2`    | `by_task`, `by_slot_state`, `by_machine_state_updatedAt` |
| `chatroom_taskTransitionsV2`    | `by_task_sequence`, `by_chatroom_occurredAt`             |
| `chatroom_taskDependenciesV2`   | `by_task`, `by_dependsOnTask`                            |
| `chatroom_taskAttachmentsV2`    | `by_task_position`, `by_attachedTask`                    |
| `chatroom_agentSlotsV2`         | `by_chatroom_role`, `by_machine`                         |
| `chatroom_agentConfigsV2`       | `by_slot`, `by_machine_updatedAt`                        |
| `chatroom_agentRuntimeV2`       | `by_slot`, `by_machine_state`                            |
| `chatroom_agentPresenceV2`      | `by_slot`, `by_machine_updatedAt`                        |
| `chatroom_machineCommandsV2`    | `by_machine_status_createdAt`, `by_idempotencyKey`       |
| `chatroom_machineEventsV2`      | `by_machine_sequence`, `by_chatroom_sequence`            |
| `chatroom_machineFeedCursorsV2` | `by_machine`                                             |

Invariants to enforce in mutations:

- `role` is normalized once at the boundary; all keys use the normalized value.
- There is one current slot per `(chatroomId, role)`.
- There is one current config, runtime row, and presence row per slot.
- A task has at most one active assignment unless the product explicitly enables parallel attempts.
- `attempt` is monotonically increasing per task.
- `idempotencyKey` is required for machine commands.
- Every state mutation that must be observed by a daemon appends exactly one machine event in the same transaction.
- No event consumer relies on `_creationTime` or wall-clock timestamps for resume correctness.

Because Convex has no unique indexes, each logical unique key should also be stored as a deterministic string (`slotKey`, `assignmentKey`, or `idempotencyKey`) and checked inside the same mutation that inserts the row.

## Feed contracts

The daemon should consume one cursor-pinned machine feed rather than separate task-signal and presence feeds that are derived from a joined snapshot.

Every feed item should include:

```text
eventId
machineId
sequence
eventType
aggregateId
payloadVersion
payload
```

The daemon's local read model can still expose a convenient joined view to the task monitor. That join belongs in the daemon read model, where a heartbeat only updates one presence record. It does not belong in the Convex write path.

Commands should remain a separate feed because command delivery needs claim, retry, expiry, and acknowledgement semantics. Facts/events need replay and retention semantics. Combining them recreates the current `chatroom_eventStream` coupling.

## Migration strategy

### Phase 0 — lock the invariants

Before writing v2 code, record the current behavior that must remain true:

- task status transition matrix and queue ordering;
- assignment/reassignment and agent recovery behavior;
- which events are commands versus historical facts;
- realtime SLI for task status, agent status, and messages;
- retention requirements for task transitions and machine events;
- authorization boundary: machine owners may only read commands/events for their machines.

### Phase 1 — add v2 tables and pure translators

Add the v2 schema with no v1 reader changes. Write pure translators from the authoritative v1 sources into v2 rows. Do not generate live machine events for historical backfill rows; mark the backfill checkpoint separately so daemons do not replay old state as new work.

### Phase 2 — backfill and parity checks

Backfill current state from `chatroom_tasks`, `chatroom_teamAgentConfigs`, `chatroom_participants`, and `chatroom_machines`. Derive assignments from those sources, not from the denormalized snapshot when possible. Use the snapshot only as a diagnostic comparison because it may contain projection drift.

Compare v1 and v2 at the read-model boundary:

- active task IDs per machine;
- assignment role and machine binding;
- desired config and runtime PID/state;
- participant presence values;
- command eligibility and expiry.

Any mismatch should be observable and block cutover for that machine or environment.

### Phase 3 — dual projection, not duplicated business logic

Keep v1 reads and behavior unchanged while a single projection service writes v2. Do not add independent v2 writes to every mutation caller. The source mutation should call one projection boundary that updates v1 and v2 during the transition, or enqueue one durable projection job if the daemon is already the source of truth.

The old snapshot table may remain populated during this phase, but it must stop being the place where v2 derives its semantics. This keeps rollback possible without making v1 the design constraint.

### Phase 4 — shadow reads and canary cutover

Run the daemon's v2 feed and local join in shadow mode. Compare decisions, not only row equality: task delivery eligibility, restart decisions, nudge timing, and command claims must match. Enable v2 for one machine or internal environment first, with a feature flag that can return reads to v1.

### Phase 5 — cut over consumers

Cut over in this order:

1. daemon task monitor and agent process manager;
2. daemon command delivery;
3. webapp task/agent status queries;
4. timeline/history queries.

Keep v1 writes and the compatibility query available until the v2 consumers have passed at least one normal release cycle and the rollback window has closed.

### Phase 6 — retire v1 projections

Stop writing `chatroom_machineAssignedTaskSnapshots`, then retain it read-only for a defined period. Remove the old full-snapshot subscription and timestamp cursor code. Only after parity metrics and rollback are no longer needed should the old table and deprecated event variants be deleted.

## Rollback

Rollback should be a read-path switch, not a data rewrite:

- v1 and v2 remain available during the migration window;
- the daemon can switch back to v1 hydration/feed consumers;
- v2 projection continues so it can catch up;
- no v2-to-v1 reverse migration is required while v1 writes are retained;
- destructive cleanup is deferred until the rollback window expires.

If the daemon becomes the canonical owner of orchestration, rollback means stopping the v2 projection worker and replaying the local outbox, not restoring Convex snapshots. This is why the local event log and outbox should be introduced before removing v1 writes.

## What should not be cloned into v2

- Do not create a v2 copy of every existing table just for naming consistency.
- `chatroom_machines`, `chatroom_machineLiveness`, and `chatroom_machineModels` already demonstrate useful separation; extend their ownership boundaries instead of renaming them.
- `chatroom_commandRunsV2`, `chatroom_commandRunTailsV2`, and `chatroom_commandOutputV2` already separate metadata, live state, and bulk output; keep that pattern.
- Do not put task content into machine feed events or assigned-task rows. Fetch content only for the action that needs it.
- Do not introduce a role table unless roles gain first-class lifecycle/permissions. A normalized role key is sufficient for this migration.

## Decisions still needed

1. **Canonical owner:** Should v2 task/agent orchestration be Convex-authoritative for the first release, or should the daemon-local SQLite store become authoritative immediately? My recommendation is daemon-local for high-churn orchestration, with Convex v2 as an idempotent projection.
2. **Parallel assignments:** Can a task have multiple simultaneously active agent slots, or must the mutation reject that state? The schema supports history either way; the invariant affects delivery logic.
3. **Retention:** How long must task transitions and machine events remain replayable? This determines cleanup jobs and whether the webapp can rebuild timelines from v2 alone.
4. **Compatibility window:** How many releases should v1 readers and projections remain available after the last v2 canary succeeds? I recommend one full release cycle plus an operational rollback window.

## Bottom line

I agree with a clean v2 implementation. I would make it a normalized orchestration model plus a compact machine feed, not a normalized-looking copy of the current snapshot table. The highest-value first slice is `agentSlotsV2` + separate config/runtime/presence, `taskAssignmentsV2`, and `machineCommandsV2`/`machineEventsV2`. The task core and relationship tables can follow behind the same boundary if we are ready to migrate all task APIs.
