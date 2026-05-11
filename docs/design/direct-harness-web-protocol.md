# Direct Harness — Web Frontend ↔ Backend Protocol

**Status:** Draft — requirements capture, not yet implemented
**Date:** 2026-05-04

---

## 1. Goals

Replace the current 8 frontend-facing endpoints with 3 simple operations. Eliminate the
`chatroom_pendingPrompts` table entirely — the daemon subscribes to sessions + messages directly.

## 2. Frontend Endpoints (the only ones the web UI calls)

### 2.1 `createSession`

Creates a new session with an initial message from the user.

```
createSession(workspaceId, harnessName, config, firstMessage) → { sessionId }
```

- `sessionId` is returned immediately.
- The session row is created with `status = 'pending'`.
- The first message is written to the message stream.
- No pending prompt row is created — the daemon picks up the new session via its subscription.

**What the daemon does** (asynchronously, after the frontend gets back `sessionId`):
1. Detects the new session via its session subscription.
2. Boots the harness if not already running.
3. Opens an SDK session.
4. Fetches the last unprocessed message from the message stream.
5. Sends it as a prompt to the SDK via `session.prompt()`.
6. Writes response chunks back to the message stream.

### 2.2 `sendMessage`

Appends a message to an existing session's message stream.

```
sendMessage(sessionId, text) → { messageSeq }
```

- The message is appended to the message stream with a monotonically increasing sequence number.
- `messageSeq` is returned so the frontend can track it.
- No pending prompt row is created.
- The daemon, on its next poll, sees `seq > lastProcessedSeq` and processes it.

**What the daemon does:**
1. Detects new messages for the session via its subscription.
2. If it doesn't have an active SDK session for this session, revives it (resumes via `session.get()`).
3. Sends the new message(s) as prompts to the SDK.
4. Writes response chunks back to the message stream.

### 2.3 `subscribeToSession`

Cursor-based subscription that returns only new messages since the last seen seq.

```
subscribeToSession(sessionId, afterSeq?) → Message[]
```

- `afterSeq` — the last seq the frontend has seen. Omit/null for the first call (returns all).
- Returns only messages with `seq > afterSeq`.
- Frontend calls this on mount and on each Convex subscription update.
- Messages include both user messages and daemon response chunks, ordered by seq.

---

## 3. Daemon-side Subscription

The daemon does NOT use pending prompts anymore. Instead:

### 3.1 Session subscription

```
listPendingSessionsForMachine(machineId) → Session[]
```

Returns sessions with `status = 'pending'`. Daemon opens each one (boot harness, create SDK session,
associate ID, flip status to `'active'`).

### 3.2 Message subscription

```
listUnprocessedMessages(sessionId, lastProcessedSeq) → Message[]
```

Returns messages with `seq > lastProcessedSeq`. The daemon keeps `lastProcessedSeq` in memory per
session. When it sees new messages, it calls `session.prompt()` for each.

- No `claim`/`complete` cycle.
- No `chatroom_pendingPrompts` table.
- Idempotent: if the daemon restarts, it re-processes from its last known seq (responses are
  written to the message stream, and the daemon just re-reads them — the old response chunks are
  already there, so the daemon would interpret them as prompts again).

  **Mitigation:** the daemon's `lastProcessedSeq` should be persisted to Convex on each new
  response, or the daemon should distinguish user messages from response chunks (e.g., via a
  `role` field: `'user'` vs `'assistant'`).

---

## 4. Data Model

### 4.1 `chatroom_harnessSessions` (unchanged from current)

- `workspaceId`, `harnessName`, `harnessSessionId?`, `lastUsedConfig`, `status`, timestamps.

### 4.2 `chatroom_harnessSessionMessages` (unchanged from current)

- `harnessSessionRowId`, `seq`, `content`, `timestamp`.
- The `seq` field is monotonically increasing per session for both user messages and daemon
  response chunks.

### 4.3 `chatroom_pendingPrompts` (deleted)

No longer needed — removed entirely.

---

## 5. Naming Convention

- **Endpoint:** `sessions.create` (not `createSession`, consistent with Convex naming style)
- **Endpoint:** `messages.send`
- **Endpoint:** `messages.subscribe` (or just `messages.list`)
- **Daemon query:** `sessions.pendingForMachine` (already exists as `listPendingSessionsForMachine`)
- **Daemon query:** `messages.deltaForSession`

---

## 6. Migration

Since nothing direct-harness is released, changes are made in place:

1. Deprecate current web-facing endpoints.
2. Implement new `sessions.create`, `messages.send`, `messages.subscribe` endpoints.
3. Update frontend to use new endpoints, delete old frontend code.
4. Remove `chatroom_pendingPrompts` table and all submit/claim/complete orchestration.
5. Update daemon subscribers to poll messages directly.
6. Delete deprecated endpoints.
