# `getMachineOwner` codemap report

## 1. `getMachineOwner` entry

### Entry point

`services/backend/convex/auth/cli/machineAccess.ts:72`

```ts
getMachineOwner(ctx, sessionId, machineId): Promise<MachineAuth | null>
```

The helper is a fail-open authorization check:

1. Resolve `sessionId` to a `userId` with `getSession`.
2. Return `null` if the session is invalid.
3. Call `checkAccess` for `{ type: 'machine', id: machineId }` with `permission: 'owner'`.
4. Return `null` if the user does not own the machine.
5. Return `{ userId }` if authorized.

### Database path

`getSession` uses the CLI-aware resolver in `services/backend/modules/auth/cli-session.ts`:

- `cliSessions`, queried by `by_sessionId` first.
- `sessions`, queried by `by_sessionId` as the fallback.

The resolver reads the session identity/validity fields needed to resolve the user:

- `cliSessions.sessionId`, `isActive`, `expiresAt`, `userId`
- `sessions.sessionId`, `userId`

It does not read the `users` document.

For the machine-owner check, `services/backend/modules/auth/accessCheck.ts` queries:

- `chatroom_machines`, by `by_machineId`
- compares `chatroom_machines.userId` to the session `userId`

For the `owner` permission path, it does not query `chatroom_workspaces` or `chatroom_rooms`.

The fields `cliSessions.lastUsedAt`, `sessions.lastActivityAt`, and `chatroom_machines.lastSeenAt` are not logically used by `getMachineOwner`.

## 2. Use cases supported by the entry

`getMachineOwner` is used by machine-scoped queries and subscriptions that should return an empty/null result instead of throwing when authentication or ownership fails.

### Daemon enhancer authentication

- `services/backend/convex/daemon/enhancer/auth.ts:5`
- Provides the shared `getDaemonMachineAuth` wrapper for enhancer daemon operations.
- The wrapper preserves fail-open behavior for queries; related mutation paths can use the fail-closed `requireMachineOwner` helper.

### Machine task/status synchronization

- `services/backend/convex/tasks.ts:1126` — hydrates task snapshots for a machine and signal range.
- `services/backend/convex/messageList.ts:194` — subscribes to machine task-status signals.
- `services/backend/convex/machines.ts:2223` — subscribes to machine operational-status signals.
- `services/backend/convex/machines.ts:2265` — hydrates operational-status rows for a signal range.
- `services/backend/convex/machines.ts:2287` — bootstraps operational status for a machine.

Unauthorized requests return empty pages, `null`, or an empty list depending on the endpoint.

### Machine model and daemon status queries

- `services/backend/convex/machines.ts:621` — reads available machine models after authorization.
- `services/backend/convex/machines.ts:654` — reads daemon connectivity for one machine.
- `services/backend/convex/machines.ts:697` — reads daemon connectivity for a batch of machines.

These endpoints read the following datasets after authorization:

- `chatroom_machineModels` / legacy `chatroom_machines.availableModels`
- `chatroom_machineStatus`
- `chatroom_machineLiveness`

The daemon-status endpoints expose `chatroom_machineLiveness.lastSeenAt`, not `chatroom_machines.lastSeenAt`.

## 3. Writers of the underlying datasets

### `cliSessions`

#### Creation

CLI session approval inserts a row in `services/backend/convex/cliAuth.ts:215`:

- `sessionId`
- `userId`
- `isActive: true`
- `createdAt`
- `lastUsedAt`
- `expiresAt`

#### Activity touch

`services/backend/convex/cliAuth.ts:336` (`touchSession`) patches:

- `lastUsedAt`
- `expiresAt`

This is the only production update path for `lastUsedAt`.

#### Revocation

`services/backend/convex/cliAuth.ts:406` (`revokeSession`) patches:

- `isActive: false`
- `revokedAt`
- `revokedReason`

#### Deletion

`services/backend/convex/chatroomCleanup.ts:432` and `:444` delete inactive or stale CLI-session rows. The stale-session pass uses `lastUsedAt` older than 90 days.

### `sessions`

#### Creation and identity updates

Session rows are created or linked by authentication flows in `auth.ts`, Google authentication, admin invite flows, and internal session helpers. These paths update session identity/authentication fields such as `userId` and `authMethod`; they do not routinely update `lastActivityAt`.

#### Activity update

`services/backend/convex/sessions.ts:174` (`updateSessionActivity`) patches:

- `lastActivityAt: Date.now()`
- `deviceInfo`, only if device information is supplied and not already present

#### Internal device/activity update

`services/backend/convex/sessions.ts:216` (`updateSessionDeviceInfo`) patches:

- `deviceInfo`
- caller-supplied `lastActivityAt`

These are the two production write paths for `sessions.lastActivityAt`.

### `chatroom_machines`

#### Registration

`services/backend/convex/machines.ts:207` patches an existing machine during re-registration, including:

- `lastSeenAt`
- hostname/OS/capabilities/model data

`services/backend/convex/machines.ts:228` inserts a new machine with:

- `registeredAt`
- `lastSeenAt`
- `daemonConnected: false`

#### Capability refresh

`services/backend/convex/machines.ts:316` (`refreshCapabilities`) patches:

- `availableHarnesses`
- `harnessVersions`
- `availableModels`
- `lastSeenAt`

#### Explicit daemon status update

`services/backend/convex/machines.ts:823` (`updateDaemonStatus`) patches:

- `daemonConnected`
- `lastSeenAt`

This is retained as a backward-compatibility write while `chatroom_machineStatus` becomes the authoritative status projection.

#### Capabilities refresh request

`services/backend/convex/machines.ts:400` updates `lastCapabilitiesRefreshRequestedAt`; it does not update `lastSeenAt`.

#### Heartbeat distinction

`daemonHeartbeat` does not update `chatroom_machines.lastSeenAt`. It updates:

- `chatroom_machineLiveness.lastSeenAt`, throttled by `DAEMON_LIVENESS_WRITE_INTERVAL_MS` (90 seconds)
- `chatroom_machineLiveness.daemonConnected`
- `chatroom_machineStatus` when the online/offline state changes

The daemon sends heartbeats every five minutes, but this activity is intentionally isolated from `chatroom_machines`.

## 4. Impact of deprecating the fields

### `cliSessions.lastUsedAt`

Impact: **high relative to the other fields**.

Current consumers:

- `touchSession` updates it.
- `listUserSessions` returns it in its API response.
- `cleanupCliSessions` uses it to delete active CLI sessions that have been unused for 90 days.
- The schema currently requires it on `cliSessions` rows.

If it is removed without a replacement:

- stale active CLI sessions may never be cleaned up;
- CLI-session listing loses last-use information;
- `touchSession` must be removed or changed;
- existing rows require a migration or a temporary optional schema field.

Possible replacement: use a different activity timestamp if one is introduced, or use `createdAt` for a simpler fixed-lifetime cleanup policy. That would change the meaning from “unused for 90 days” to “created more than 90 days ago.”

### `sessions.lastActivityAt`

Impact: **low**.

Current consumers:

- `listSessions` includes it in the session-management response.
- `listSessions` sorts sessions by `lastActivityAt`, falling back to `createdAt`.
- `updateSessionActivity` and `updateSessionDeviceInfo` write it.

If it is removed:

- session-management ordering falls back to creation order;
- the activity/device update mutations must stop writing it or change their contract;
- the field can be removed with relatively little authorization risk because session validation does not use it.

### `chatroom_machines.lastSeenAt`

Impact: **medium**, concentrated in cleanup.

Current consumers:

- `cleanupMachines` deletes machines whose `chatroom_machines.lastSeenAt` is older than 90 days.
- Registration, capability refresh, and explicit daemon status updates write it.
- The field is present in the machine schema and is initialized on registration.

If it is removed or stops being updated:

- machine cleanup can no longer use its current query/filter;
- machines could become immortal unless cleanup is rewritten;
- registration, capability refresh, and legacy daemon-status writes need adjustment;
- `getMachineOwner` authorization is unaffected;
- current daemon-status UI is expected to remain functional because it reads `chatroom_machineLiveness.lastSeenAt` instead.

Possible replacement: make machine cleanup consult `chatroom_machineLiveness.lastSeenAt`. Because Convex cannot filter `chatroom_machines` directly by a field in another table, cleanup would likely need to iterate candidate machines and look up liveness rows, or maintain a dedicated indexed cleanup timestamp.

### Recommended deprecation sequence

1. Replace CLI-session cleanup’s `lastUsedAt` policy and update `touchSession`/`listUserSessions`.
2. Replace machine cleanup’s use of `chatroom_machines.lastSeenAt` with liveness or a dedicated cleanup timestamp.
3. Remove session-list activity sorting if `sessions.lastActivityAt` is no longer needed.
4. Stop new writes.
5. Update API return types and schema definitions.
6. Migrate or tolerate existing rows before removing required fields.

None of these three fields is part of the authorization decision made by `getMachineOwner`; the main risks are cleanup behavior, session-management metadata, and compatibility with existing schema rows.
