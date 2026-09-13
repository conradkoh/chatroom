# Consolidate agent launch requests, commands, and status

> Status: **complete**. This plan records the completed consolidation slice and
> the remaining capability-model work that is intentionally deferred to a
> separate migration. The checked items below describe the implemented and
> verified boundary; deferred work is not treated as another source of truth.

## Objective and completed outcome

The agent feature now has three explicit backend responsibilities:

1. The webapp owns unsent launch-form edits locally. Convex stores the exact
   last request sent by the webapp and the command inbox payload, but does not
   maintain a continuously reconciled desired runtime state.
2. The daemon owns actual process and lifecycle state. Convex stores a thin
   daemon-fed role-status read model for web presentation.
3. Static team definitions own structural roles, entry points, and structural
   capabilities. Convex stores only the active definition ID for each room.

The implementation also removes the obsolete desired-config, runtime-state,
operational-summary, view-metadata, enhancer-config, and duplicate
workspace-agent command models. Start/restart/stop are explicit one-time
commands; they are not desired-state mutations.

## Final table design

Static team definitions are immutable shared code entities, not Convex rows.
`chatroom_activeTeamStructures` is the only room-specific team selection.

### 1. Source-of-truth tables

These tables store application facts owned by the webapp or application
domain. None of them is authoritative for daemon process state.

| Table                                                                  | Owns                                                                                | Does not own                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `chatroom_rooms`                                                       | Room identity, ownership, name, lifecycle, and room-only settings.                  | Team structure, launch configuration, PID, or agent status.            |
| `chatroom_activeTeamStructures`                                        | The active immutable `teamStructureId` for each room, with assignment audit fields. | Copied team roles, entry point, or agent state.                        |
| `chatroom_machines`                                                    | Stable registered-machine identity and registration metadata.                       | Connectivity, capabilities, model catalogs, or agent processes.        |
| `chatroom_workspaces`                                                  | Registered workspace identity, machine binding, and working directory.              | Agent status or unsent form state.                                     |
| `chatroom_primaryWorkspaces`                                           | The primary workspace selection for a room.                                         | Workspace details or agent state.                                      |
| `chatroom_agentLastSentLaunchRequests`                                 | The latest exact start/restart payload sent by the webapp for a role.               | Daemon acknowledgement, desired runtime state, PID, or current status. |
| `chatroom_machineModelFilters`                                         | User-controlled model visibility preferences.                                       | Discovered model availability.                                         |
| `chatroom_machineConfigFavorites` / `chatroom_enhancerConfigFavorites` | Optional user-ranked launch presets while those UI features remain.                 | Current or desired agent state.                                        |
| `chatroom_participants`                                                | Presence, session linkage, and task-routing coordination.                           | Agent lifecycle/status; deprecated mirrors are compatibility-only.     |
| `chatroom_enhancerJobs`                                                | Enhancer job input, immutable execution snapshot, and job history.                  | Global enhancer-agent configuration or general runtime state.          |

### 2. Daemon-fed read models

The daemon remains authoritative. The webapp cannot write these models as
application state.

| Table                                                     | Presentation data                                                                               | Update source                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `chatroom_agentRoleStatusReadModel`                       | Latest role status, observed machine/workspace, event ordering fields, and user-visible errors. | Authenticated, idempotent daemon lifecycle outbox ingestion. |
| `chatroom_machineLiveness`                                | Latest heartbeat timestamp used for machine-health presentation and cleanup.                    | Daemon heartbeat ingestion.                                  |
| `chatroom_machineStatus`                                  | Machine connectivity transition projection.                                                     | Daemon heartbeat/expiry processing.                          |
| `chatroom_machineModels`                                  | Daemon-published model catalog used by launch forms.                                            | Capability/model publication.                                |
| `chatroom_machineIdentity` and `chatroom_machineRegistry` | Existing compatibility/capability projections used by machine and workspace UI.                 | Daemon capability publication and compatibility paths.       |
| `chatroom_agentRestartMetrics`                            | Optional restart analytics, not current status.                                                 | Daemon lifecycle facts.                                      |

Machine models, identity, and registry remain separate capability projections
in this slice. They are not agent configuration or agent status. A future
capability migration may consolidate them into one
`chatroom_machineCapabilities` table after its consumers and migration are
specified.

### 3. Webapp-to-daemon inboxes

| Table                          | Role                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `chatroom_machineCommandInbox` | The single machine-directed lifecycle transport for self-contained start, restart, stop-role, stop-chatroom, and related commands. |

The inbox is short-lived transport state. The durable latest-request snapshot
is retained separately. Task-delivery inboxes remain separate because they are
task-domain protocols, not lifecycle commands.

### Removed models

The following models are deleted and must not be reintroduced as compatibility
sources of truth:

- `chatroom_agentDesiredConfigs`
- `chatroom_agentRuntimeStates`
- `chatroom_agentOperationalSummary`
- `chatroom_agentViewMetadata`
- `chatroom_enhancerConfigs`
- `chatroomWorkspaceAgentCommandsInbox`
- `chatroom_agentLaunchPreferences` — never create this table

The removed models are replaced by static team definitions, the active-team
assignment, last-sent request snapshots, the canonical command inbox, and the
daemon-fed status read model according to the ownership tables above.

## Structural team configuration

Static definitions resolve the complete structural contract: display name,
roles, permanent/ephemeral classification, entry point, handoff rules, and
structural capabilities. Definitions are immutable and should use versioned
IDs such as `duo@1`; changing a definition creates a new ID.

`chatroom_activeTeamStructures` has one row per room:

```text
chatroom_activeTeamStructures {
  chatroomId
  teamStructureId
  createdAt
  updatedAt
  updatedBy
}
```

Creating or switching a room writes only this assignment. Team-specific fields
on `chatroom_rooms` (`teamId`, `teamName`, `teamRoles`, `teamEntryPoint`) are
deprecated compatibility fields: new code does not write them, and active
team resolution uses the assignment plus static definitions. They remain in
the schema until a bounded legacy-data migration can remove them safely.

Permanent roles must render even when no launch request or status row exists;
their initial status is `offline`.

## Launch requests and status

Unsubmitted form edits remain local to the webapp. There is no saved launch
preference or desired-state mutation. On explicit start/restart, Convex
validates the request, writes an immutable latest-request snapshot, and
enqueues the same self-contained payload in `chatroom_machineCommandInbox`.
The daemon handles the copied payload directly and does not reconcile against
a mutable Convex configuration row.

The daemon owns process existence, PID/session identity, lifecycle transitions,
activity, provider failures, restart policy, and recovery. It emits durable
outbox facts. Convex applies those facts monotonically to
`chatroom_agentRoleStatusReadModel`; it never infers actual status from a
participant row, last-sent request, PID mirror, task transition, or machine
connectivity.

## Canonical web boundary

The webapp uses these boundaries:

### Structural configuration

- `chatrooms.create` — accepts `teamStructureId` and creates the active
  assignment.
- `chatrooms.getTeamStructureForChatroom` — resolves the active assignment and
  static definition.
- `chatrooms.updateTeam` — replaces the active assignment using only the
  structure ID.

### Launch request reads

- `agents.getStartFormData` — static role and capability data for a launch form.
- `agents.getLastSentLaunchRequest` and
  `agents.listLastSentLaunchRequests` — the last exact request sent by the
  webapp.

### Agent status reads

- `agents.getViewStatus` — canonical agent-panel view.
- `agents.getStatus` — one role status.
- `agents.listStatus` — current-team role status, including offline roles with
  no prior request.
- `agents.listChatroomStatus` and `agents.listStatusForAllChatrooms` — listing
  and activity presentation.

### Explicit commands

- `machines.startAgent` remains the existing start/restart command entry point
  for this migration slice and writes a request snapshot plus the canonical
  command inbox payload.
- `agents.requestStop` and `agents.requestStopAll` are the canonical stop
  entry points.

The next API cleanup may move start/restart under `agents.requestStart` and
`agents.requestRestart`, but it must preserve the same one-time command and
snapshot semantics. No webapp caller may read or write the deleted desired,
runtime, summary, view-metadata, enhancer-config, or workspace-agent command
models.

## Deleted backend functions and paths

The consolidation removed the old desired/runtime/view model use cases and
their callers, including:

- desired-config persistence and team-agent-config patching;
- agent runtime-state and operational-summary projection helpers;
- the old chatroom agent overview and view-metadata paths;
- legacy enhancer-config reads, writes, and migration helpers;
- the workspace-agent command transport, subscriber, and completion path;
- obsolete agent registration, spawn-state, exit, and machine status APIs that
  duplicated the canonical status projection.

The remaining internal projection helpers are transport/projection details,
not additional web-facing sources of truth. Any future status writer must be
an authenticated daemon-outbox ingestion path and must preserve idempotent,
monotonic ordering.

## Completion checklist

### Ownership and schema

- [x] Static team definitions and the active assignment are the only
      structural-team authorities.
- [x] New room creation and team switching write the active assignment rather
      than room-level team configuration.
- [x] Last-sent launch snapshots, command transport, and daemon status are
      separate data responsibilities.
- [x] Deleted desired/runtime/summary/view/enhancer/workspace-command tables
      have no active production callers.
- [x] `chatroom_agentLaunchPreferences` is explicitly rejected as an
      unnecessary model.
- [x] Deprecated room team fields and participant status mirrors are marked as
      compatibility-only and are not new sources of truth.

### Webapp and backend boundaries

- [x] Permanent roles render from static structure with `offline` status when
      no agent has ever been started.
- [x] Webapp agent panels and chatroom listings use `agents.*` status reads.
- [x] Start/restart data is submitted as an explicit request; unsent form edits
      do not persist backend configuration.
- [x] Stop-role and stop-chatroom commands use the canonical machine inbox.
- [x] No webapp code uses deleted desired/runtime/configuration APIs.

### Daemon status

- [x] Daemon lifecycle failures and provider failures use the durable outbox
      path.
- [x] Status projection ordering is monotonic and rejects stale or
      cross-machine observations.
- [x] Convex status is a read model and does not drive continuous daemon
      reconciliation.

### Validation

- [x] Backend, webapp, CLI, and shared-package typechecks pass:
      `pnpm turbo run typecheck --filter=@workspace/backend
--filter=@workspace/webapp --filter=chatroom-cli --filter=@workspace/shared`.
- [x] Generated Convex and CLI API bindings are synchronized.
- [x] Repository search confirms deleted agent tables and legacy lifecycle
      endpoints are absent from active production paths.
- [x] The plan is updated to distinguish implemented state from deferred
      machine-capability consolidation.

## Deferred follow-up, intentionally outside this completed plan

These are separate migrations, not hidden authorities in the current design:

- remove deprecated `chatroom_rooms.team*` fields and participant lifecycle
  mirrors after a legacy-data audit and compatibility-read removal;
- consolidate machine identity, model catalogs, and registry payloads into a
  clearly named capability read model;
- decide whether favorites and restart metrics justify their persistence;
- move start/restart naming into the `agents.requestStart`/
  `agents.requestRestart` namespace;
- add full daemon reconnect/acknowledgement integration coverage for the outbox
  transport.

Each follow-up must preserve the three ownership categories in this document
and must not recreate a backend desired-state reconciliation loop.

## Definition of done

- [x] Convex is the web-facing configuration/request-snapshot and read-model
      layer, not the owner of daemon runtime state.
- [x] The daemon is the authority for actual agent status.
- [x] Structural roles come from static definitions and the active-team
      assignment, so an empty room still exposes launchable permanent roles.
- [x] The webapp has canonical functions for structural reads, last-sent
      request reads, status reads, and explicit lifecycle commands.
- [x] Removed tables and APIs are not alternative sources of truth.
- [x] Remaining compatibility and capability cleanup is explicitly bounded as
      follow-up work rather than mixed into this plan.
