# Consolidate agent configuration and status state

> Status: **complete** — 2026-09-13

## Objective

Keep the web-facing Convex layer small and explicit:

- Convex stores the webapp’s structural configuration and the latest request
  snapshot sent to the daemon.
- The daemon owns agent processes, lifecycle state, retries, recovery, and
  actual status.
- Convex stores daemon-fed read models only for web presentation.
- Webapp-to-daemon actions enter through explicit inbox commands; Convex does
  not continuously reconcile a desired runtime state.

## Architectural observations

Static team definitions are immutable code entities. A room stores only the
active structure identifier in `chatroom_activeTeamStructures`; roles,
entry-point behavior, lifecycle classification, and structural capabilities are
resolved from that identifier. `chatroom_rooms` no longer stores team-specific
columns. Legacy create inputs are accepted only as a non-persisted migration
compatibility boundary.

The webapp keeps unsubmitted launch-form edits locally. On an explicit start or
restart, it sends the complete request to Convex. Convex records the exact
last-sent snapshot and places the same payload in the machine command inbox.
There is no mutable desired-state row for the daemon to reconcile.

The daemon is authoritative for process and lifecycle state. It emits durable
outbox facts. Convex accepts those facts monotonically into a thin role-status
read model and never infers status from a participant, launch snapshot, task
transition, PID, or machine connectivity row.

Participant rows retain presence and task-routing coordination only. Lifecycle
status and desired-state mirrors were removed from the participant shape and
assigned-task transport. Token-activity recovery reads the daemon-fed role
status model.

### Deployment compatibility boundary

The target architecture and the deployed Convex schema have different
lifecycles. Existing deployments may still contain documents written by older
versions, so deprecated fields on populated tables remain registered as
optional validators until their data has been migrated or retired. Legacy
tables that may still contain documents remain registered as compatibility-only
schema definitions where deployment compatibility requires it. The desired and
runtime compatibility tables remain registered while their remaining callers
and historical data are migrated. The six retired machine/agent projection
tables (`chatroom_machineLastSeenAt`, `chatroom_machineModels`,
`chatroom_agentOperationalSummary`, `chatroom_agentViewMetadata`,
`chatroom_machineIdentity`, and `chatroom_machineRegistry`) have now been
purged by migration and removed from the schema. The enhancer-specific
configuration and favorites tables are fully retired rather than retained as
compatibility tables; their data now uses the canonical launch-request and
machine-favorites stores.

This remaining compatibility layer includes the old room/team fields,
participant lifecycle mirrors, embedded machine capability fields, role-status
aliases (`teamId`, `operationalState`, `viewState`, and `isAlive`), and the
retained desired/runtime tables. The six removed projection tables no longer
need deployment-compatibility definitions because their rows were purged first.

## Final table design

This is the target inventory after the unwanted duplicate models are removed.

### 1. Source-of-truth tables

These tables store application facts owned by the webapp or application domain.
They do not claim to know daemon process state.

| Table                                  | Data stored                                                                 | Authority boundary                                                 |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `chatroom_rooms`                       | Room identity, owner, name, lifecycle, room-only settings                   | Room facts only; no team, launch, PID, or status fields            |
| `chatroom_activeTeamStructures`        | One active immutable `teamStructureId` per room and assignment audit fields | Current structural team selection                                  |
| `chatroom_machines`                    | Stable registered-machine identity and registration metadata                | Machine identity only                                              |
| `chatroom_workspaces`                  | Workspace identity, machine binding, and working directory                  | Workspace registration only                                        |
| `chatroom_primaryWorkspaces`           | Primary workspace selection for a room                                      | Selection only                                                     |
| `chatroom_agentLastSentLaunchRequests` | Exact latest start/restart request sent by the webapp for a role            | Last webapp request snapshot, not daemon acknowledgement or status |
| `chatroom_machineModelFilters`         | User-controlled model visibility preferences                                | UI preference only, not discovered availability                    |
| `chatroom_machineConfigFavorites`      | Optional user-ranked launch presets                                         | UI preference only; shared by permanent and ephemeral roles        |
| `chatroom_participants`                | Presence, session linkage, and task-routing coordination                    | No lifecycle status or desired-state authority                     |
| `chatroom_enhancerJobs`                | Enhancer input, immutable execution snapshot, and job history               | Enhancer job domain only                                           |

### 2. Daemon-fed read models

The daemon remains the source of truth. Webapp code does not write these as
application state.

| Table                               | Data stored                                                                                           | Update source                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `chatroom_agentRoleStatusReadModel` | Latest role status, observed machine/workspace, ordering fields, active work, and user-visible errors | Idempotent daemon lifecycle outbox ingestion         |
| `chatroom_machineCapabilities`      | One machine capability snapshot: harnesses, versions, models, and discovered workspace/harness data   | Daemon capability publication                        |
| `chatroom_machineLiveness`          | Daemon heartbeat recency                                                                              | Daemon heartbeat ingestion                           |
| `chatroom_machineStatus`            | Online/offline transition projection                                                                  | Daemon heartbeat and expiry processing               |
| `chatroom_agentRestartMetrics`      | Optional historical restart analytics                                                                 | Daemon lifecycle facts; never used as current status |

The former machine model, registry, identity, and registration-recency
projections are not parallel sources. Stable identity remains on
`chatroom_machines`; volatile capability data is consolidated into
`chatroom_machineCapabilities`; heartbeat data remains in liveness/status.

### 3. Inboxes

| Table                              | Data stored                                                                                       | Processing owner                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `chatroom_machineCommandInbox`     | Self-contained one-time start, restart, stop-role, stop-chatroom, ping, and local-action commands | Daemon consumes and acknowledges commands      |
| Task-delivery inbox/receipt tables | Task delivery protocol events and acknowledgements                                                | Daemon task service consumes the task protocol |

Inbox rows are transport state, not desired state. A command being pending does
not mean that an agent is running.

## Removed models and functions

The following tables are retired from the application model and must not be
used as active state. The desired/runtime tables remain as compatibility-only
schema definitions until their remaining callers and historical data are
migrated:

- `chatroom_agentDesiredConfigs`
- `chatroom_agentRuntimeStates`

The following six retired projection tables were purged by migration and
removed from the schema:

- `chatroom_agentOperationalSummary`
- `chatroom_agentViewMetadata`
- `chatroom_machineLastSeenAt`
- `chatroom_machineModels`
- `chatroom_machineRegistry`
- `chatroom_machineIdentity`

These other retired models were removed by earlier consolidation work and are
listed here for historical completeness:

- `chatroom_enhancerConfigs`
- `chatroomWorkspaceAgentCommandsInbox`
- `chatroom_agentLaunchPreferences`
- `chatroom_enhancerConfigFavorites`

The following duplicate paths were removed or retired:

- desired-config persistence and continuous desired-state reconciliation;
- runtime-state, operational-summary, and view-metadata projections;
- legacy enhancer-config persistence and migration paths;
- enhancer-specific favorites persistence and migration paths;
- workspace-agent command transport and completion paths;
- participant lifecycle/desired-state mirrors;
- machine capability writes to the machine identity row, embedded machine
  capability fields, and separate model/registry projections.

## Canonical web boundary

### Structural configuration

- `chatrooms.create` — creates a room and its active structure assignment.
- `chatrooms.getTeamStructureForChatroom` — resolves the active static
  structure for presentation and role selection.
- `chatrooms.updateTeam` — changes only the active structure assignment.

### Launch request reads

- `agents.getStartFormData` — returns static role context plus daemon-published
  capabilities and defaults.
- `agents.getLastSentLaunchRequest` and
  `agents.listLastSentLaunchRequests` — read the exact latest webapp request.
- `agents.saveConfig` — persists a submitted role configuration in the same
  last-sent launch-request store without starting a process.

### Agent status reads

- `agents.getViewStatus` — canonical agent panel view.
- `agents.getStatus` — one role status.
- `agents.listStatus` — all roles from the active static team, including
  permanent roles with no status row as `offline`.
- `agents.listChatroomStatus` and `agents.listStatusForAllChatrooms` — listing
  and activity views.

### Explicit commands

- `agents.requestStart` — canonical webapp start command.
- `agents.requestRestart` — canonical webapp restart command.
- `agents.requestStop` and `agents.requestStopAll` — canonical stop commands.

The web hooks route start/restart through `agents.requestStart` and
`agents.requestRestart`. `machines.sendCommand` remains only as a compatibility
transport for non-webapp/daemon command callers and does not define a second
webapp source of truth.

## Completion checklist

Mark each item done only after the corresponding validation is true.

### Ownership and schema

- [x] Static team definitions plus `chatroom_activeTeamStructures` are the only
      structural-team authorities.
- [x] `chatroom_rooms` has no persisted team-specific fields.
- [x] `chatroom_participants` and assigned-task transport have no lifecycle or
      desired-state mirrors.
- [x] Last-sent snapshots, command inboxes, daemon status, liveness, and
      capabilities are separate responsibilities.
- [x] Machine capabilities are consolidated into
      `chatroom_machineCapabilities`.
- [x] Desired/runtime/summary/view/enhancer/workspace-agent command tables and
      duplicate machine capability tables have no active production callers.
- [x] `chatroom_agentLaunchPreferences` is explicitly rejected and absent.
- [x] Shared machine favorites and restart metrics are explicitly classified
      as UI preference and analytics data, not configuration or status
      authorities.

### Webapp and backend boundaries

- [x] Permanent roles render from static structure with `offline` status before
      any launch request or daemon status exists.
- [x] Webapp status panels and listings use `agents.*` reads.
- [x] Unsubmitted launch-form edits remain local to the webapp.
- [x] Enhancer configuration uses the shared launch-request and machine-favorites
      stores; enhancer-specific tables and migrations are removed.
- [x] Start/restart requests snapshot the submitted payload and enqueue the
      same one-time command payload.
- [x] Webapp start/restart calls use `agents.requestStart` and
      `agents.requestRestart`.
- [x] Stop-role and stop-chatroom commands use the canonical machine inbox.

### Daemon status and transport

- [x] Daemon lifecycle facts use the durable outbox path.
- [x] Outbox delivery retries after transient failures.
- [x] Persisted lifecycle facts replay after daemon reconnect and are removed
      only after successful acknowledgement.
- [x] Status projection ordering is monotonic and rejects stale or
      cross-machine observations.
- [x] Convex status does not drive continuous daemon reconciliation.

### Data migration and cleanup

- [x] Existing rooms are backfilled into the active-team assignment before
      legacy room fields are removed.
- [x] Legacy participant lifecycle fields are removed by migration.
- [x] Old machine identity, model, registry, and registration-recency models
      have no active callers; their rows were purged and their schema
      definitions were removed. Desired/runtime compatibility definitions remain
      until their remaining callers and historical data are migrated.
- [x] Generated Convex bindings are synchronized.
- [x] Repository search confirms the removed models are absent from active
      production paths.
- [x] Deprecated populated-table fields remain optional in the schema instead
      of being removed before deployment compatibility is verified.
- [x] Dev deployment codegen succeeds with the compatibility schema, and
      recent dev logs show successful function execution without the legacy
      role-status schema mismatch.

### Verification

- [x] Backend, webapp, CLI, and shared-package typechecks pass:
      `pnpm turbo run typecheck --filter=@workspace/backend
--filter=@workspace/webapp --filter=chatroom-cli
--filter=@workspace/shared`.
- [x] Canonical agent read/registration tests pass.
- [x] Web agent-start/listing tests pass.
- [x] Daemon lifecycle outbox retry, reconnect, replay, and acknowledgement
      tests pass.

## Long-term direction

Future agent features should first identify whether a new datum is:

1. a web-owned configuration/request fact;
2. a daemon-owned fact projected for presentation; or
3. an inbox transport event.

If it does not fit one category, it should not become another agent table by
default. In particular, do not add a Convex desired-state row merely to make
daemon reconciliation convenient.
