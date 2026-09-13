# Consolidate agent launch requests, commands, and status

> Status: **in progress**. The active-team, last-sent-launch-request, static-role
> rendering, and explicit-start migration slices are implemented and verified.
> The plan is not complete until the remaining legacy backend consumers,
> daemon-outbox contract, remaining schema deletions, and full compatibility
> test migration are finished.

## Objective

Consolidate the agent backend around four clear ownership boundaries:

1. **Launch requests:** the webapp holds unsent form choices locally. Convex
   persists the latest exact request only when the user explicitly submits a
   start/restart request. Each command carries its own immutable payload.
2. **Runtime status:** the daemon is the source of truth for actual process and
   lifecycle status. Convex stores only a thin, consumer-facing read model,
   updated by reliable daemon outbox delivery.
3. **Team structure:** static shared team definitions are the source of truth
   for roles, entry points, and structural capabilities. A separate Convex
   assignment table stores which definition is active for each chatroom.
4. **Commands and request snapshots:** start, stop, and restart are explicit,
   one-time commands. Each launch command carries an immutable snapshot of the
   values sent to the daemon, and Convex retains a durable “last sent” view for
   the webapp after the transport inbox row is acknowledged or deleted.

The webapp must have one deliberate public read/update boundary for each data
set. Internal Convex use cases may compose the same primitives, but webapp
callers must not choose among historical machine, team, workspace, participant,
or projection endpoints.

This is a long-term consolidation plan. It should be implemented in staged,
backward-compatible migrations rather than as one large table rewrite.

## Current architectural observations

The repository already has the beginnings of the intended split:

- `chatroom_agentDesiredConfigs` is documented as user-owned desired
  configuration, but the target command-oriented model has no standalone
  desired-config or launch-preference table.
- `chatroom_agentRuntimeStates` contains runtime/process state.
- `chatroom_agentRoleStatusReadModel` is documented as the frontend projection.
- `chatroom_agentOperationalSummary` is a chatroom-level materialized summary.
- `chatroom_participants` tracks daemon/task connections and still contains
  deprecated status mirrors.

The remaining problems are overlapping readers and writers, not the absence of
all the required concepts. In particular:

- `machines.getTeamAgentConfigs` returns historical rows without current-team
  filtering.
- `machines.saveTeamAgentConfig` both saves configuration and changes runtime
  state/start semantics.
- `machines.getMachineAgentConfigs` exposes runtime PID and actual harness data
  in a configuration-shaped response.
- `chatroom_agentViewMetadata.teamRoles` duplicates structural roles from
  `chatroom_rooms`.
- `chatroom_agentRoleStatusReadModel` has multiple status representations and
  multiple projection writers. The daemon lifecycle path now persists an
  event timestamp/revision watermark and rejects stale or cross-machine
  observations; legacy backend writers still require migration.
- enhancer settings still exist in both `chatroom_enhancerConfigs` and the
  enhancer row in `chatroom_agentDesiredConfigs`.
- several queries independently derive “running/stopped/none” from desired
  config plus runtime PID.
- `chatroom_machineCommandInbox` already snapshots the complete
  `agent.requestStart`/`agent.restart` payload, but it is short-lived and its
  row is deleted after acknowledgement, so it cannot be the durable “last
  sent” record.
- agent lifecycle commands were previously split between
  `chatroom_machineCommandInbox` and `chatroomWorkspaceAgentCommandsInbox`.
  The stop-command migration now uses the canonical machine inbox; the legacy
  workspace-agent inbox has been deleted.
- The team-switch path previously treated the desired-config table as a
  reconciliation queue: it preserved/restored/seeded rows and automatically
  stopped or started agents. That behavior is now removed from the migration
  slice; a structural switch records the active assignment and re-routes
  affected tasks, while agent lifecycle changes remain explicit commands.
- The user start/restart migration slice no longer projects `running` status in
  Convex. The webapp records the submitted request and command; daemon status
  must arrive through the status ingestion path.

Relevant current schema and projection definitions:

- [`chatroom_rooms`](../../services/backend/convex/schema.ts:310) currently
  contains deprecated team-specific fields that must be removed.
- A new `chatroom_activeTeamStructures` table will own the active team
  structure assignment for each chatroom.
- [`chatroom_agentDesiredConfigs`](../../services/backend/convex/schema.ts:1151)
  currently owns role configuration and should be deleted after its useful
  values are migrated into last-sent launch snapshots.
- [`chatroom_agentRuntimeStates`](../../services/backend/convex/schema.ts:1185)
  currently mixes desired lifecycle intent, runtime state, and observed process
  fields.
- [`chatroom_agentRoleStatusReadModel`](../../services/backend/convex/schema.ts:1226)
  is the current frontend role-status projection.
- [`chatroom_agentOperationalSummary`](../../services/backend/convex/schema.ts:1300)
  is the current chatroom-level status projection.

## Proposed final Convex table inventory

This is the proposed target-state inventory for team selection, agent launch,
command delivery, and agent status after the migrations in this plan. General
chatroom content tables such as messages, tasks, contexts, and artifacts are
outside this inventory and remain unchanged unless called out elsewhere.

Static team definitions are deliberately absent from this list: they live in
the shared domain package, not in Convex. Convex stores only the active static
definition ID for each chatroom.

### 1. Source-of-truth tables

These tables store durable application facts owned by the webapp/application.
They never claim to describe the daemon’s current runtime.

| Final table                            | Authoritative for                                                                     | Data stored                                                                                                                                                                                  | Explicitly not stored                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `chatroom_rooms`                       | Room identity and lifecycle.                                                          | Owner, user-visible name, room status, activity timestamps, context linkage, and room-only settings.                                                                                         | Team ID/name/roles/entry point, agent launch configuration, or runtime status.              |
| `chatroom_activeTeamStructures`        | Which immutable static team definition is active for a room.                          | `chatroomId`, `teamStructureId`, audit timestamps, and actor.                                                                                                                                | Copied structural definition fields or agent state.                                         |
| `chatroom_machines`                    | Stable registered-machine identity.                                                   | Machine ID, owner, hostname/alias, operating system, and registration metadata.                                                                                                              | Heartbeats, online status, model catalogs, agent processes, or other volatile capabilities. |
| `chatroom_workspaces`                  | Registered workspace identity.                                                        | Chatroom, machine, working directory, display/registration/removal metadata, and workspace-only settings.                                                                                    | Agent process status or unsent launch configuration.                                        |
| `chatroom_primaryWorkspaces`           | Which registered workspace is primary for a room.                                     | `chatroomId`, `workspaceId`, and update timestamp.                                                                                                                                           | Workspace details, team structure, or agent state.                                          |
| `chatroom_agentLastSentLaunchRequests` | The exact latest agent launch request submitted by the webapp.                        | One latest row per chatroom/team structure/role with request and command IDs, machine/workspace, harness, model, working directory, resume choice, reason, requester, and request timestamp. | Daemon acknowledgement, desired runtime state, PID, or inferred current status.             |
| `chatroom_machineModelFilters`         | User-controlled model visibility preferences.                                         | Hidden models/providers per machine and harness.                                                                                                                                             | Discovered model availability.                                                              |
| `chatroom_machineConfigFavorites`      | Optional user-controlled ranked launch presets, only if this product feature remains. | Machine/team/role-scoped harness and model favorites.                                                                                                                                        | Current or desired agent state.                                                             |
| `chatroom_participants`                | Task-session connection and presence coordination.                                    | Role identity, connection/session linkage, task-routing fields, and presence fields that genuinely belong here.                                                                              | Agent lifecycle/status mirrors such as `lastStatus` and `lastDesiredState`.                 |
| `chatroom_enhancerJobs`                | Enhancer job request and execution history.                                           | Job input, immutable execution configuration snapshot, ownership, and job lifecycle.                                                                                                         | Global enhancer agent configuration or general agent runtime state.                         |

Static team definitions are also source of truth, but they are shared code
entities rather than Convex tables.

### 2. Daemon-fed read models

These tables exist only to present daemon-owned observations to the webapp.
Daemon-local state remains authoritative. The webapp cannot write these tables,
and backend business logic must not reinterpret them as desired state.

| Final table                         | Presentation data stored                                                                                                                                                                                                  | Update source                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chatroom_agentRoleStatusReadModel` | Thin latest observation per chatroom/team structure/role: canonical status, observed machine/workspace, process or daemon incarnation ID needed for ordering, latest event sequence/time, and user-visible error details. | Idempotent, monotonic daemon outbox ingestion only.                                                                                                   |
| `chatroom_machineLiveness`          | High-frequency latest daemon heartbeat timestamp, indexed for stale-machine cleanup.                                                                                                                                      | Daemon heartbeat ingestion.                                                                                                                           |
| `chatroom_machineStatus`            | Low-frequency online/offline transition projection used by web subscriptions. Machine status never implies agent status.                                                                                                  | Derived only from daemon heartbeat arrival/expiry.                                                                                                    |
| `chatroom_machineCapabilities`      | Canonical latest daemon-observed machine/workspace capabilities: harnesses, versions, providers, models, agent descriptors, and configuration schemas needed by launch forms.                                             | Daemon capability publication. Replaces overlapping capability data in `chatroom_machines`, `chatroom_machineModels`, and `chatroom_machineRegistry`. |
| `chatroom_agentRestartMetrics`      | Optional daemon-derived restart aggregates used only by restart charts/counters.                                                                                                                                          | Daemon lifecycle outbox events. Delete the table and UI if restart analytics are removed.                                                             |

The proposed final model deletes `chatroom_agentOperationalSummary` and derives
chatroom-level agent status from `chatroom_agentRoleStatusReadModel`. If load
testing proves that a materialized aggregate is required, add exactly one
daemon-fed `chatroom_agentChatroomStatusReadModel` to this section; do not
restore config-, PID-, participant-, or command-derived status logic.

### 3. Webapp-to-daemon inboxes

Inbox tables are transport queues, not configuration or runtime state. Webapp
mutations authenticate, validate, snapshot, and enqueue. They do not process
agent lifecycle work or update status. The daemon claims each item, performs
the work locally, and reports observations independently through its outbox.

| Final table                    | Commands stored                                                                                                                                                                                 | Lifecycle                                                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chatroom_machineCommandInbox` | Self-contained start, restart, stop-role, stop-chatroom, and other machine-directed commands, including request ID, target machine, complete payload, deadline, attempt count, and claim lease. | Written through webapp-facing command mutations, claimed by the daemon, then deleted or archived after transport acknowledgement/expiry. Durable “last sent” launch data remains in `chatroom_agentLastSentLaunchRequests`. |

`chatroom_machineCommandInbox` is the single agent command transport. The
stop-role and stop-chatroom variants have been moved into it, and the former
workspace-agent command inbox is deleted. Task-delivery inboxes outside agent
lifecycle remain separate only where they carry a distinct task-domain
protocol.

### Tables absent from the final model

| Removed table                              | Replacement                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposed `chatroom_agentLaunchPreferences` | Do not create it. Unsubmitted form state remains local; prior submitted values come from `chatroom_agentLastSentLaunchRequests`.             |
| `chatroom_agentRuntimeStates`              | Daemon-local process/runtime state plus daemon-outbox status projection. No replacement desired-state table.                                 |
| `chatroom_agentDesiredConfigs`             | `chatroom_agentLastSentLaunchRequests`; no standalone preference or desired-state replacement.                                               |
| `chatroom_enhancerConfigs`                 | Configuration snapshot on the enhancer job or launch request that used it.                                                                   |
| `chatroom_agentViewMetadata`               | Static team definition, `chatroom_rooms` room-only data, and derived message/history state.                                                  |
| `chatroom_agentOperationalSummary`         | Derived query over `chatroom_agentRoleStatusReadModel`, or one narrowly defined daemon-derived aggregate only if required by measured scale. |
| `chatroomWorkspaceAgentCommandsInbox`      | Agent command variants in the canonical `chatroom_machineCommandInbox`.                                                                      |
| `chatroom_machineIdentity`                 | Canonical identity fields in `chatroom_machines`.                                                                                            |
| `chatroom_machineLastSeenAt`               | Indexed heartbeat timestamp in `chatroom_machineLiveness`.                                                                                   |
| `chatroom_machineModels`                   | Canonical daemon-fed `chatroom_machineCapabilities`.                                                                                         |
| `chatroom_machineRegistry`                 | Canonical daemon-fed `chatroom_machineCapabilities`.                                                                                         |

## Target ownership contract

### 1. Structural team configuration

**Authoritative source:**

- Static, versioned team definitions in the shared domain package.
- `chatroom_activeTeamStructures`, which stores only the active definition ID
  for each chatroom.

The static definition must resolve the complete structural contract:

- display name;
- roles and permanent/ephemeral classification;
- entry point;
- handoff rules;
- enhancer and other structural capabilities;
- any role metadata required by the webapp.

Use an immutable, versioned identifier such as `duo@1` or `solo@1`. A bare
identifier such as `duo` is unsafe if changing the definition would alter the
meaning of existing chatrooms or launch-request keys.

The new table should have one row per chatroom, for example:

```text
chatroom_activeTeamStructures {
  chatroomId
  teamStructureId
  createdAt
  updatedAt
  updatedBy
}
```

It must not duplicate the definition’s name, roles, or entry point. Enforce one
active assignment per chatroom with a unique/indexed chatroom lookup and an
atomic replacement mutation when the user switches teams.

All team-specific fields on `chatroom_rooms` are deprecated and must be
removed after migration:

- `teamId`
- `teamName`
- `teamRoles`
- `teamEntryPoint`

`chatroom_rooms` remains responsible for room identity and room lifecycle, not
team structure. The canonical resolver should be equivalent to:

```ts
const assignment = getActiveTeamStructure(chatroomId);
const structure = getTeamDefinition(assignment.teamStructureId);
```

Structural team roles must not depend on a launch-request row, participant row,
runtime row, or status projection row. A permanent role with no prior request
is still a valid candidate for the webapp’s launch form.

Custom or unknown team IDs must be resolved before this migration completes:
either map them to an immutable static definition or explicitly retire them.
The current persisted-role fallback in `getTeamStructure` must not survive as
an ongoing source of structural truth.

`chatroom_agentViewMetadata` must not remain a second authority for team
structure. Remove its duplicated `teamId`, `teamName`, and `teamRoles` fields;
if the table has no remaining projection-only purpose, delete it.

### 2. Launch-form inputs

There is no authoritative Convex launch-preference table. Before submission,
the webapp owns the in-progress form state locally. It resolves initial values
from, in order:

1. the role’s last-sent launch request, when one exists;
2. an explicitly selected favorite, if the favorites feature is retained;
3. current workspace/machine capabilities and static application defaults.

For a role that has never launched, the static team definition still makes the
role visible and launchable. No configuration row is required to render the
form.

`chatroom_workspaces` owns workspace identity (`workspaceId`, `machineId`, and
`workingDir`). The form may select among those values, but the selected
machine, workspace, harness, and model become persisted agent data only when
copied into an explicit launch request.

Changing the local form does not update Convex or the daemon. Closing an
unsubmitted form may discard those changes. Cross-device unsent drafts are not
part of the target feature surface.

### 3. Explicit commands and last-sent request snapshots

Start, stop, and restart are one-time commands, not desired-state mutations.
The mutation that issues a launch must atomically:

1. resolve and validate the active team structure and submitted form values;
2. copy every submitted launch value into an immutable command payload;
3. enqueue that payload for the selected daemon; and
4. write a durable latest-request snapshot for the webapp.

The daemon must process the copied payload directly. It must not fetch a
mutable configuration row later.

Prefer a dedicated latest projection such as
`chatroom_agentLastSentLaunchRequests`, with one row per
`(chatroomId, teamStructureId, role)`, containing:

- a stable request/correlation ID;
- the exact machine, workspace, harness, model, working directory, resume
  choice, and reason sent;
- `requestedBy` and `requestedAt`;
- the transport command ID where useful.

This table records only what the webapp enqueued. It is not proof that the
daemon accepted, started, or remains synchronized with the request. Delivery
and runtime outcomes belong to the command transport and daemon-fed status
read model respectively.

For presentation, the webapp may use the latest snapshot as the assumed active
launch configuration until the daemon reports a newer or contradictory
observation. The UI and API should preserve `requestedAt` and request identity
so this assumption is distinguishable from daemon-confirmed status. No
background reconciliation follows from that assumption.

The existing short-lived command inbox remains the transport mechanism, with a
canonical payload schema and acknowledgement cleanup that does not delete the
durable latest-request snapshot. All agent lifecycle command variants now use
`chatroom_machineCommandInbox`; the former workspace-agent command inbox and
its daemon subscriber have been deleted.

### 4. Actual agent status

**Authoritative source:** the daemon’s local runtime/process state.

The daemon owns:

- whether a process exists;
- process PID and session identity;
- actual machine/workspace/harness/model;
- lifecycle transitions;
- waiting/working activity;
- provider/runtime errors;
- restart and circuit-breaker behavior;
- local reconciliation and recovery complexity.

“Reconciliation” here means local reconciliation between the daemon’s process
manager, persisted local metadata, and operating-system processes. It does not
mean continuously comparing daemon state with a Convex desired-state row.

Convex receives daemon status through a reliable, idempotent outbox protocol
and stores only a thin read model for web subscribers. Convex must not infer
actual process state from `chatroom_participants`, last-sent request snapshots,
backend task transitions, or a stale PID mirror.

The target Convex status projection should have one clear status vocabulary. A
recommended minimum is:

- `offline`
- `starting`
- `waiting`
- `working`
- `stopping`
- `error`

If lifecycle and activity need separate dimensions, they must be named and
documented separately. Avoid the current ambiguous mix of `status`,
`operationalState`, `viewState`, `isAlive`, and `isRunning` unless each is
needed by a distinct consumer.

### 5. Presence and task connection state

**Authoritative source:** `chatroom_participants` for connection/presence and
task-session coordination only.

Participants are not agent configuration and not runtime status. The following
fields must remain deprecated or be removed after consumers migrate:

- `lastStatus`
- `lastDesiredState`
- other lifecycle mirrors

Participant rows may still be used for connection IDs, machine association,
last check-in, and task routing where those concepts genuinely belong.

### 6. Machine state

Machine identity, capabilities, model catalogs, daemon connectivity, and agent
runtime status are separate concerns:

- `chatroom_machines`: stable registered identity only;
- `chatroom_machineCapabilities`: daemon-fed harness, provider, model,
  workspace, and agent capability observations;
- `chatroom_machineStatus` / `chatroom_machineLiveness`: daemon connectivity;
- daemon-local state: actual agent processes.

Machine online status must never be presented as agent running status.

### 7. Enhancer launch configuration

`chatroom_enhancerConfigs` and the enhancer row in
`chatroom_agentDesiredConfigs` are overlapping saved configuration sources.
Neither remains in the target model.

The migration target is:

- the enhancer form resolves defaults from the last-sent request, optional
  favorites, and current machine capabilities;
- starting an enhancer copies its submitted configuration into the immutable
  launch request;
- an enhancer job stores its own immutable execution configuration snapshot
  when job-specific configuration is needed;
- `chatroom_enhancerConfigs` is retained only for one-time migration and
  compatibility reads;
- after all callers migrate, the legacy table and sync functions are deleted.

## Target web-facing Convex API

Create one public agent boundary, preferably an `agents` Convex module rather
than continuing to grow `machines.ts`. The exact module name can be finalized
during implementation, but the responsibilities should be fixed.

### Launch-form and request-snapshot reads

Proposed canonical functions:

- `agents.getLastSentLaunchRequest`
  - returns the exact latest start/restart payload enqueued by the webapp for a
    role;
  - clearly distinguishes `requestedAt` from daemon-reported runtime time;
  - does not imply delivery or runtime success.
- `agents.getStartFormData`
  - resolves the active static team definition and returns structural roles,
    registered machines, capabilities, and resolved defaults;
  - does not claim that a machine or agent is connected/running.
- `agents.getWorkspaceDirectory`
  - returns roles from the active static team definition plus relevant
    last-sent requests for the selected workspace;
  - this replaces the webapp’s need to combine several legacy directory/config
    endpoints.

The webapp should use one canonical team resolver, such as
`agents.getTeamStructureForChatroom`, for the active team ID and resolved
static definition. It must not read `chatroom_rooms.team*` fields directly.

### Explicit commands

Proposed canonical functions:

- `agents.requestStart`, `agents.requestStop`, and `agents.requestRestart`
  - are one-time control operations, not desired-state writes;
  - snapshot the complete effective request before enqueueing it;
  - enqueue a self-contained daemon command;
  - status changes arrive later from the daemon outbox.

There is no public save-config/preference mutation. Start and restart receive
the complete submitted form values. The immutable request snapshot and
short-lived transport command remain distinct records with distinct meanings.

### Status reads

Proposed canonical functions:

- `agents.getStatus`
  - one role status from the thin Convex projection.
- `agents.listStatus`
  - current-team per-role status for one chatroom.
- `agents.listChatroomStatus`
  - an aggregate derived from, or explicitly projected from, per-role daemon
    status for chatroom-listing needs.

The webapp must use these status functions instead of reading runtime tables,
participants, PIDs, or machine connectivity directly.

### Daemon status ingestion

Proposed daemon-only function:

- `internal.agents.ingestStatusOutboxBatch`
  - authenticates the machine/daemon;
  - accepts event IDs and a monotonic per-machine or per-agent sequence;
  - applies idempotent status updates to the thin read model;
  - acknowledges only after the projection write succeeds.

This function must not be used by the webapp and must not accept arbitrary
webapp-authenticated status updates.

## Target daemon/Convex flow

```text
daemon local runtime state
        │
        ├── local status transition
        │
        ├── durable daemon outbox
        │       (event id, sequence, role, status, observed fields)
        │
        └── Convex daemon ingestion mutation
                │
                └── chatroom_agentRoleStatusReadModel
                        │
                        ├── agents.getStatus
                        ├── agents.listStatus
                        └── chatroom-listing aggregate projection/query

webapp start/restart action
        │
        ├── chatroom_agentLastSentLaunchRequests
        │       (durable exact request snapshot)
        │
        └── command inbox
                │
                └── daemon handles the command once
```

Unsubmitted form changes remain local to the webapp. Only an explicit command
affects the daemon. The last-sent snapshot records webapp intent, while the
daemon reports the actual result through its outbox.

## Functions to consolidate or delete

The following list is a migration inventory, not an instruction to delete
everything immediately.

### Public Convex functions to replace

| Current function                                   | Target action                                                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `chatrooms.create`                                 | Accept only `teamStructureId`; create the active-team assignment row and resolve all structural fields server-side.                           |
| `chatrooms.getTeamStructureForChatroom`            | Read the active assignment table and resolve the static team definition. It must not fall back to room fields.                                |
| `chatrooms.updateTeam`                             | Accept only `teamStructureId`; atomically replace the active assignment. Historical launch snapshots remain scoped by immutable structure ID. |
| `machines.getTeamAgentConfigs`                     | Delete; use static team roles plus `agents.getLastSentLaunchRequest` where previous submitted values are needed.                              |
| `machines.getMachineAgentConfigs`                  | Delete; use separate last-request and status reads.                                                                                           |
| `machines.saveTeamAgentConfig`                     | Delete; start/restart accepts the complete submitted configuration.                                                                           |
| `machines.saveAgentDesiredConfig`                  | Delete without replacement.                                                                                                                   |
| `machines.getAgentStartConfig`                     | Move/rename to `agents.getStartFormData`.                                                                                                     |
| `machines.listRemoteAgentRunningStatus`            | Delete after consumers use `agents.listChatroomStatus`.                                                                                       |
| `machines.getAgentViewStatus`                      | Replace with canonical team-structure + status reads.                                                                                         |
| `machines.getAgentRoleStatusReadModel`             | Replace with `agents.listStatus`.                                                                                                             |
| `machines.listAgentRoleStatusReadModel`            | Replace with one canonical status-listing query.                                                                                              |
| `agentWorkspaces.listConfiguredAgentsForWorkspace` | Replace with static roles plus last-sent request snapshots.                                                                                   |
| `agentWorkspaces.getAgentConfigForWorkspaceRole`   | Replace with `agents.getLastSentLaunchRequest`.                                                                                               |
| `agentWorkspaces.getAgentStatusForWorkspaceRole`   | Replace with canonical status query.                                                                                                          |

The old functions should first become thin compatibility wrappers with usage
instrumentation. Delete them only after webapp, CLI, tests, and daemon callers
are migrated.

### Internal backend functions to replace

- `transitionAgentStatus`
  - remove once backend task/message/participant flows stop writing inferred
    agent status.
- `projectAgentRoleStatusReadModel`
  - replace with the single daemon outbox projection writer.
- `projectAgentOperationalStatusForRole`
- `rebuildAgentOperationalStatusForChatroom`
- `rebuildAgentOperationalStatusForMachine`
  - delete the config/PID-derived operational projection path; retain only a
    one-off migration/backfill utility until the new daemon projection is
    proven.
- `agent-runtime-state.ts` helpers
  - delete with `chatroom_agentRuntimeStates` after runtime ownership moves to
    the daemon.
- `recordAgentSpawnedState`
- `registerSpawnedAgentIfAuthorized`
- `agentExited`
- `applyAgentActivityHeartbeat`
  - replace backend lifecycle/status mutation paths with daemon outbox events.
- `patchTeamAgentConfig`
  - delete after legacy desired-config writes are removed.
- `getAgentConfig`
  - replace with a last-sent-request reader only where prior submitted values
    are needed; command handlers use the submitted payload directly.
- `getTeamStructure` / `getTeamEntryPoint`
  - retain only as static-definition resolvers; remove persisted-role and
    persisted-entry-point fallback arguments.

Backend functions that issue commands—start, stop, restart, shutdown, and
workspace command delivery—should remain, but should only validate the request,
write the last-sent snapshot, and enqueue a self-contained command. They must
not write desired runtime state or claim actual status.

## Data models to consolidate or delete

### Delete after migration

1. **Team-specific fields on `chatroom_rooms`**

   Remove `teamId`, `teamName`, `teamRoles`, and `teamEntryPoint` after all
   readers and writers use `chatroom_activeTeamStructures` plus the static
   definition registry. These fields are deprecated compatibility data, not a
   second source of truth.

2. **`chatroom_agentRuntimeStates`**

   Delete this table entirely after command and daemon-outbox migration. Move
   process identity, lifecycle, circuit-breaker state, restart/session state,
   and observed tuples to daemon-local state. Remove `desiredState` rather than
   relocating it to another backend runtime table. Store only last-sent request
   snapshots, command transport state, and the daemon-fed status read model in
   Convex.

3. **`chatroom_agentDesiredConfigs`**

   Migrate the latest useful submitted values into
   `chatroom_agentLastSentLaunchRequests` only where a historical command or
   lifecycle fact proves they were sent. Discard unsent/ambiguous rows, update
   callers, and delete the old table. Do not create
   `chatroom_agentLaunchPreferences` or another standalone configuration
   replacement.

4. **`chatroom_enhancerConfigs`**

   Delete after enhancer submissions snapshot configuration directly onto the
   launch request or enhancer job.

5. **`chatroom_agentViewMetadata`**, or at minimum its duplicated team fields

   Prefer moving `hasHistory` to `chatroom_rooms` or deriving it from the
   message/read-model state, then delete the table if it has no remaining
   projection-only purpose.

6. **`chatroom_agentOperationalSummary`**, conditionally

   If chatroom-listing scale permits, derive aggregate status from the thin
   role-status read model and delete this table. If a materialized aggregate is
   required, retain it under a name such as
   `chatroom_agentChatroomStatusReadModel` and define it strictly as a
   projection of daemon-reported status, never request snapshots plus backend
   PID logic.

7. **`chatroomWorkspaceAgentCommandsInbox`**

   **Deleted.** Its stop-role and stop-chatroom command variants now live in
   `chatroom_machineCommandInbox`, and the daemon consumes that canonical
   transport.

8. **`chatroom_machineIdentity`**

   Delete this read projection. It duplicates `machineId`, `userId`, and
   `hostname` already stored in `chatroom_machines` and is currently used only
   by the legacy agent-view projection path being removed.

9. **`chatroom_machineLastSeenAt`**

   Add the required ordered `lastSeenAt` index to
   `chatroom_machineLiveness`, migrate cleanup scans, and delete the duplicate
   recency projection. One daemon heartbeat timestamp should have one owner.

10. **`chatroom_machineModels` and `chatroom_machineRegistry`**

    Create one daemon-fed `chatroom_machineCapabilities` read model, migrate
    the model catalogs and rich per-workspace harness/provider/agent
    capabilities into it, remove duplicate capability fields from
    `chatroom_machines`, and delete both legacy tables.

### Optional product-surface deletions

These tables support real UI features rather than backend correctness. Remove
them if those conveniences are not worth dedicated persistence:

- `chatroom_machineConfigFavorites` and
  `chatroom_enhancerConfigFavorites`
  - remove the ranked-favorites UI and use the last-sent launch request plus
    deterministic defaults to initialize forms;
  - this eliminates two tables, their mutations/hooks, and team-switch seeding
    logic.
- `chatroom_agentRestartMetrics`
  - remove the restart charts and 3-hour/3-day counters from agent cards;
  - daemon-local logs and observability can retain operational diagnostics
    without making restart analytics part of the application data model.

`chatroom_machineRegistry` is not deleted until its rich
per-workspace/harness/provider payload and `chatroom_machineModels` have been
migrated into `chatroom_machineCapabilities`. The resulting capability table
is a daemon-fed read model and must not be merged with agent status.

### Simplify in place

- `chatroom_activeTeamStructures`: retain as the only room-specific active
  team selection. It must contain an immutable definition ID and assignment
  audit timestamps, but no copied structural fields.
- `chatroom_machineCommandInbox`: retain as the single command transport,
  including stop-role and stop-chatroom variants. Transport cleanup must not
  remove durable last-sent snapshots.
- `chatroom_agentRoleStatusReadModel`: remove fields no longer needed after the
  daemon status contract is finalized. Keep only the thin web projection.
- `chatroom_participants`: remove deprecated lifecycle/status mirror fields once
  all readers migrate.
- `chatroom_machines`: remove deprecated `daemonConnected`, `lastSeenAt`, and
  embedded capability/model fields after compatibility rollout gates complete.

### Retain for distinct responsibilities

- `chatroom_workspaces`: registered workspace identity.
- `chatroom_agentLastSentLaunchRequests`: durable latest-request projection for
  the webapp, separate from runtime status.
- `chatroom_machineStatus` and `chatroom_machineLiveness`: machine health,
  not agent health.
- `chatroom_machineCapabilities`: daemon-fed launch-form capability data.
- `chatroom_machineConfigFavorites`: retain only if ranked favorites remain an
  explicit product feature; otherwise delete it with the favorites UI.
- `chatroom_agentRestartMetrics`: historical metrics, not current status.
- `chatroom_enhancerJobs`: job history/execution state, not enhancer agent
  configuration.
- `chatroom_machineCommandInbox`: short-lived, claimable delivery from Convex
  to the daemon.

## Implementation phases

This section is the execution checklist for the migration. Mark each outcome
and validation criterion as done (`- [x]`) as it is completed and verified.
Do not mark an outcome complete until all of its validation criteria pass or
an explicitly documented exception has been approved.

### Phase 0 — Freeze and document the contract

**Key outcomes**

- [ ] Every in-scope table and function has one documented owner and purpose.
- [x] The versioned static `TeamDefinition` contract and `teamStructureId` format
      are stable enough for data migration.
- [ ] Public web APIs, daemon APIs, internal projection functions, and temporary
      compatibility wrappers are explicitly distinguished.

**Validation criteria**

- [x] Every table in the proposed final inventory is classified exactly once as a
      source of truth, daemon-fed read model, or inbox.
- [ ] Every legacy table/function named for deletion has an identified caller set
      and target replacement or explicit no-replacement decision.
- [ ] Architecture review confirms that no planned Convex table owns daemon
      desired runtime state.

### Phase 1 — Move active team selection out of `chatroom_rooms`

**Key outcomes**

- [ ] `chatroom_activeTeamStructures` is the only room-specific authority for the
      active team definition.
- [ ] Team names, roles, entry points, and capabilities resolve from immutable
      shared definitions rather than persisted room fields or client input.
- [ ] All existing chatrooms have a valid versioned team structure assignment;
      custom/unknown legacy structures are mapped or explicitly retired.

- [x] Migration slice: create and team-switch paths write the active assignment
      table, and team-structure reads prefer that assignment while legacy
      room-field fallback remains explicitly temporary.
- [x] Migration slice: team switching no longer seeds, restores, starts, or
      stops agent configuration/runtime rows; the structural switch test
      verifies zero lifecycle commands and zero legacy agent-state rows.

**Validation criteria**

- [ ] A data audit reports exactly one valid active-team row for every chatroom and
      no unresolved `teamStructureId` values.
- [ ] Create, read, and team-switch tests pass without accepting structural fields
      from the client.
- [ ] Repository search finds no authoritative production reads or writes of
      `chatroom_rooms.teamId`, `teamName`, `teamRoles`, or `teamEntryPoint` outside
      bounded migration compatibility code.
- [x] Permanent roles render from the static definition when no agent request has
      ever been submitted.

The focused create/read/team-switch regression tests for this slice pass. The
phase remains open until legacy room fields are removed and the fallback is
deleted.

### Phase 2 — Establish explicit command snapshots

**Key outcomes**

- [ ] Unsubmitted launch-form state stays in the webapp; there is no standalone
      saved agent configuration/preference API or table.
- [ ] Every start/restart produces an immutable last-sent snapshot and an identical
      self-contained daemon command in one transaction.
- [x] `chatroom_machineCommandInbox` is the single agent lifecycle command
      transport, including stop-role and stop-chatroom commands.
- [ ] Convex contains no desired-runtime field or behavior.

- [x] Migration slice: start commands carry a request ID, and the user start
      path writes `chatroom_agentLastSentLaunchRequests` with the same request
      ID and command payload values.
- [x] Migration slice: canonical `agents` reads and the webapp workspace hooks
      read last-sent requests and daemon status; webapp form edits no longer
      call a desired-config mutation.
- [x] Migration slice: stop-role and stop-chatroom requests enqueue
      `agent.stop` commands in `chatroom_machineCommandInbox`; the daemon
      claims the same inbox, and the legacy workspace-agent command inbox,
      subscriber, and completion path are deleted.

**Validation criteria**

- [ ] Editing or closing a launch form without submission creates no Convex agent
      configuration, request, command, or status row.
- [x] For every submitted launch, the durable snapshot and queued command have the
      same request ID and effective machine/workspace/harness/model payload.
- [ ] Mutating the form after submission cannot change an existing snapshot or
      queued/claimed command.
- [ ] Start, restart, stop, expiry, claim, retry, and acknowledgement tests pass
      through the single command inbox.
- [ ] Repository search finds no new `desiredState`, `saveDesiredConfig`, or saved
      launch-preference code path.

The canonical-agent regression test verifies that structural roles are listed
with offline status even when no launch request exists. Webapp typecheck passes;
legacy Convex compatibility mutations and internal desired/runtime consumers are
still intentionally present, so the full phase remains open.

The start-path snapshot regression test, backend/CLI/webapp typechecks, and
shared-package tests pass. Restart coverage remains open because the existing
restart integration fixture currently fails during unrelated task setup.

The structural team-switch regression and lifecycle authorization/register
tests also pass. These validate the new boundary, but do not close the phase:
legacy desired/runtime consumers, status-outbox delivery, and compatibility
test migration still require work.

The full backend suite is intentionally not marked complete: the current
legacy integration fixtures still seed/read `chatroom_agentDesiredConfigs` and
`chatroom_agentRuntimeStates`, so they fail while exercising the removed
desired/runtime behavior. Those fixtures and their compatibility paths are
tracked for the later deletion phases rather than being treated as proof that
the new canonical path is invalid.

### Phase 3 — Establish the daemon status outbox contract

**Key outcomes**

- [ ] The daemon durably emits versioned, ordered runtime observations through an
      outbox and remains authoritative while disconnected from Convex.
- [ ] A single authenticated ingestion boundary updates the thin role-status read
      model idempotently.
- [ ] All web agent-status presentation reads the daemon-fed model.

- [x] Migration slice: lifecycle facts delivered through the durable daemon
      outbox update the role-status read model with `lastEventAt` and
      `revisionKey`; `cleared_all_pids` no longer reads or writes desired or
      runtime state.
- [x] Migration slice: daemon start-failure and provider-unavailable reports
      are emitted as lifecycle status facts through the same durable outbox;
      their Convex handlers no longer serve as the daemon’s normal status
      transport.

**Validation criteria**

- [x] The projection writer regression proves duplicate delivery, out-of-order
      delivery, and a different machine cannot overwrite a newer role
      observation.
- [ ] End-to-end duplicate delivery produces no duplicate effects, and
      out-of-order delivery cannot regress a newer role observation through the
      durable daemon outbox.
- [ ] Daemon restart/reconnect tests prove that unsent outbox events survive and
      eventually reach Convex.
- [ ] Unauthorized machines, roles, and request correlations are rejected without
      changing the read model.
- [ ] The webapp reflects daemon status events and does not derive process state
      from requests, inbox rows, participants, PIDs, or machine connectivity.

### Phase 4 — Remove backend runtime and desired-state ownership

**Key outcomes**

- [ ] Convex request, message, task, participant, and command handlers no longer
      write or infer agent runtime state.
- [ ] Backend decisions that depend on lifecycle changes consume explicit daemon
      facts rather than inspecting cached PID or desired-state fields.
- [ ] Process ownership, restart policy, circuit breaking, and local recovery live
      entirely in the daemon.

**Validation criteria**

- [ ] Start/stop/restart mutations change only request snapshots and inbox state;
      status changes only after daemon outbox ingestion.
- [ ] Task release and lifecycle cleanup tests are driven by explicit daemon events
      and remain safe under duplicate/stale events.
- [ ] The daemon continues managing existing processes correctly during a Convex
      outage, with no desired-state polling or reconciliation loop.
- [ ] Repository search finds no production runtime-table reads/writes outside
      bounded migration code.

### Phase 5 — Migrate enhancer and workspace compatibility paths

**Key outcomes**

- [ ] Enhancer launches/jobs carry their own immutable submitted configuration and
      have no global enhancer configuration source.
- [ ] New agent requests use explicit workspace IDs; legacy machine/path matching
      is no longer part of normal reads or writes.
- [ ] `chatroom_machineCapabilities` is the single daemon-fed capability model for
      launch forms; stable machine identity contains no volatile capability data.

**Validation criteria**

- [ ] Enhancer form, launch, and job tests resolve defaults without
      `chatroom_enhancerConfigs` and preserve the exact submitted snapshot.
- [ ] Every new launch snapshot references a valid workspace owned by the target
      chatroom/machine.
- [ ] A migration audit reports all legacy workspace mappings as migrated or
      explicitly unresolved, with no silent ambiguous binding.
- [ ] Capability publication and launch-form tests use only
      `chatroom_machineCapabilities`; updates do not mutate machine identity or
      agent status.

### Phase 6 — Delete dead APIs and tables

**Key outcomes**

- [ ] Only the approved target tables and APIs remain; compatibility wrappers,
      duplicate projections, and deprecated schema fields are gone.
- [x] The obsolete workspace-agent stop-command API, schema table, daemon
      subscriber, and completion use case are deleted after migration to the
      canonical machine command inbox.
- [ ] Optional favorites and restart-analytics tables have an explicit retain or
      delete decision tied to their visible product feature.
- [ ] Historical data is retained only in deliberately named audit/metrics models
      with a confirmed consumer.

**Validation criteria**

- [ ] Schema inspection confirms every table and field listed under “Tables absent
      from the final model” is absent.
- [ ] Repository-wide search finds no imports, generated API references, string
      identifiers, tests, migrations, or documentation treating removed models as
      active.
- [ ] Production-data migration reports contain no orphan active-team assignments,
      launch snapshots, workspace references, command rows, or status rows.
- [ ] Repository-wide typecheck, unit/integration tests, webapp tests, and daemon
      tests pass against the reduced schema.
- [ ] Fresh setup and upgrade-from-legacy deployment both complete without
      compatibility readers or writers remaining enabled.

## Invariants to enforce

- Every chatroom has exactly one active team assignment in
  `chatroom_activeTeamStructures`.
- `chatroom_activeTeamStructures.teamStructureId` resolves to an immutable
  static definition; the assignment table never copies its name, roles, or
  entry point.
- `chatroom_rooms` contains no authoritative team-specific fields after the
  migration. `teamId`, `teamName`, `teamRoles`, and `teamEntryPoint` are not
  read or written by new code.
- Static team definitions are versioned and immutable. A structural change
  creates a new definition ID rather than changing the meaning of an existing
  ID.
- A structural team role can exist without a last-sent request row.
- A last-sent request row belongs to exactly one
  `(chatroom, teamStructureId, role)`.
- Historical team request snapshots never appear in current-team web reads.
- Unsubmitted form edits never write backend agent configuration or claim
  actual runtime success.
- Every start/restart command contains an immutable, self-contained launch
  snapshot; it never dereferences mutable configuration during daemon handling.
- Every enqueued launch updates the durable last-sent snapshot atomically.
- Last-sent request snapshots describe webapp intent only and are never treated
  as daemon acknowledgement or runtime truth.
- Convex has no `desiredState` or equivalent desired-runtime field, and the
  daemon does not continuously reconcile against Convex request snapshots.
- Only the daemon can assert actual process status.
- Convex status ingestion is idempotent and monotonic per role/source.
- A stale daemon event cannot overwrite a newer process/status observation.
- Machine connectivity and agent process status remain separate.
- If favorites are retained, they may prefill the form but can never alter a
  previously submitted request snapshot.
- Every webapp consumer uses the canonical agent API rather than raw table
  queries or legacy endpoint variants.

## Validation and test plan

### Backend tests

- static team definitions resolve roles, entry points, and capabilities without
  room-level role fields;
- chatroom creation and team switching create/replace the active-team
  assignment and reject client-supplied structural fields;
- every chatroom has one active-team assignment after migration;
- custom/unknown legacy teams are reported and mapped or retired before room
  team fields are removed;
- current-team filtering excludes preserved historical request snapshots;
- unsubmitted form edits do not enqueue commands, create backend configuration
  rows, or fake status events;
- start/restart atomically write an immutable last-sent snapshot and enqueue an
  identical self-contained payload;
- form edits after enqueue do not change existing command snapshots;
- command acknowledgement/expiry remains distinct from daemon runtime status;
- no backend function writes or reads a desired runtime state;
- duplicate and out-of-order daemon status events are harmless;
- status ingestion is machine-authorized and role-scoped;
- role status remains available when no last-sent request exists;
- enhancer launches and jobs carry their own immutable configuration snapshot;
- workspace-bound request snapshots cannot leak across workspaces;
- replacing the latest request does not mutate the command already delivered
  or daemon-fed status.

### Webapp tests

- team picker and chatroom views read the active static team definition rather
  than `chatroom_rooms.team*` fields;
- permanent roles render with no prior request rows;
- launch forms keep unsent edits locally and submit through only the canonical
  command API;
- the UI can distinguish local form values, last-sent request, command
  delivery, and daemon-reported status;
- status displays react only to the status read model;
- machine offline does not imply agent offline, and vice versa;
- stale historical team configs are not shown;
- chatroom listing and chatroom detail use the same status semantics.

### Daemon tests

- local status transitions always enqueue an outbox event;
- outbox retry, acknowledgement, cursor, and reconnect behavior are durable;
- duplicate delivery is idempotent;
- local daemon status remains correct while Convex is unavailable;
- local form changes have no effect until an explicit command is received;
- daemon restart/recovery uses daemon-local state and process discovery rather
  than Convex desired-state reconciliation;
- no recurring Convex polling is introduced for status discovery.

### Release gates

- repository-wide typecheck and tests;
- focused backend integration tests for immutable command snapshots and status
  ingestion;
- focused webapp tests for empty-state configuration forms;
- focused daemon outbox tests;
- `rg` audit proving removed functions/tables have no callers;
- staged migration verification in a data copy containing old team configs,
  enhancer configs, runtime rows, and participant status mirrors.

## Definition of done

- The webapp has one explicit command API, one last-sent request query, and one
  canonical status API; there is no save-preference/config API.
- Static shared team definitions are the only authority for team structure.
- Each chatroom’s active team is stored in
  `chatroom_activeTeamStructures`; `chatroom_rooms` has no team-specific
  fields.
- Convex stores last-sent request snapshots, but no standalone launch
  preferences or desired runtime state.
- Local form edits never trigger daemon reconciliation; runtime changes happen
  only through explicit commands.
- `chatroom_agentRuntimeStates` and its desired-state/runtime helpers are
  deleted.
- The daemon is the only authority for actual agent status.
- Convex status tables are thin, idempotent read models populated from daemon
  outbox events.
- No webapp query derives status from PID, participant status, or machine
  connectivity.
- Legacy backend functions and redundant data models are deleted after callers
  and migrations are complete.
