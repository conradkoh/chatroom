# Convex → Daemon Incremental Sync

Guide for syncing Convex data to the machine daemon without fat reactive snapshots or idle polling.

Use this document when adding or changing a daemon feed (tasks, commands, events, etc.).

---

## Overview

The daemon runs long-lived processes that need timely updates from Convex. Two approaches fail in production:

1. **Fat `onUpdate` on a snapshot query** — Convex re-pushes the full result whenever any dependency document changes (e.g. participant `lastSeenAt` heartbeats), including large fields the consumer never uses.
2. **Fixed-interval HTTP polling** — small responses, but query invocations accrue while idle (~1.3M/month at a 2s interval per daemon).

The standard pattern is **cursor-pinned incremental (delta) subscription** plus a **consumer working snapshot**:

| Layer         | Location                                                         | Responsibility                                                             |
| ------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Transport** | `packages/cli/src/infrastructure/incremental-sync/`              | WS subscribe, cursor, `MessageBuffer`, reconcile poll helper               |
| **Consumer**  | Co-located with the subscriber (e.g. `task-monitor-snapshot.ts`) | In-memory snapshot rows, signal patch vs reconcile replace, handler passes |

**Reference implementation:** `task-monitor.ts` + `task-monitor-snapshot.ts`

---

## Terminology

| Term                    | Meaning                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| **Incremental / delta** | `subscribe*Since` — cursor-pinned tail of small signal rows (`afterKey` exclusive)                   |
| **Reconcile snapshot**  | `list*ForReconcile` — full current rows for hydrate + periodic reconcile; response omits large blobs |
| **Action fetch**        | `get*ForAction` — one row with blobs, only when executing a side effect                              |
| **Working snapshot**    | Daemon in-memory map between reconcile ticks; not source of truth                                    |

### Response shaping ≠ reduced DB reads

A reconcile snapshot query **strips large fields from the HTTP response** (e.g. `task.content`). That reduces **wire bandwidth** and daemon memory — it does **not** automatically reduce Convex DB read cost.

The server may still read full documents to build rows (e.g. `collectAssignedTaskRows` reads task docs including `content` for signal `revisionKey` computation). Treat reconcile snapshot as **response shaping**, not a "lite read path."

**True DB bandwidth reduction** requires a backend follow-up: write-time projection tables so subscribe/reconcile queries read only the columns they need. The consumer snapshot pattern stays the same when that lands.

---

## When to use this pattern

| Use incremental sync when…                             | Use something else when…                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| The feed is long-lived and daemon-side                 | The webapp needs sub-second UI reactivity (use cursor queries in `messageList.ts`)                                      |
| Payloads would be large or grow with active work       | The result set is usually empty (e.g. pending file-tree requests — subscribe directly; see `file-tree-subscription.ts`) |
| Dependencies include high-churn fields you do not need | A one-shot fetch is enough                                                                                              |

**Rule of thumb:** if a query routinely reads many documents or returns more than ~4KB, do not put fat snapshots on `onUpdate`. Use incremental deltas + on-demand fetches for blobs.

---

## Canonical flow

Every new daemon feed should implement these steps:

### Transport (shared framework)

1. **Initial hydrate** — one-shot HTTP `list*ForReconcile` (reconcile snapshot).
2. **Seed cursor** — one-shot `subscribe*Since` to read current `highKey` so the subscription does not replay history.
3. **Subscribe** — `wsClient.onUpdate(subscribe*Since, { afterKey, … })`. On new items, advance `afterKey` and re-subscribe (`subscribe-loop` drains `hasMore` pages).
4. **Buffer** — `MessageBuffer` decouples transport from handlers; workers call `onItem`; handlers `ack()` only.

### Consumer (per feed — copy from task monitor)

5. **Working snapshot** — in-memory map of snapshot rows, keyed by stable identity (e.g. `taskId:role`). **Not** source of truth; not durable across restart.
6. **Signal path** — `onItem`: patch snapshot from incremental signal → run **signal pass** on affected row(s). No full reconcile refetch unless the row is unknown (cold hydrate).
7. **Reconcile path** — slow HTTP poll: `replaceAll` snapshot from `list*ForReconcile` → run **reconcile pass** on full snapshot.
8. **Action fetch** — when executing (inject, nudge, etc.), one-shot query for large blobs only.

```mermaid
flowchart TD
    H["1. Initial hydrate (HTTP list*ForReconcile)"] --> SNAP["Working snapshot"]
    H --> S["2. Seed afterKey (HTTP)"]
    S --> SUB["3. subscribe*Since (WebSocket)"]
    SUB --> BUF["4. MessageBuffer → onItem"]
    BUF -->|"patch row"| SNAP
    BUF --> SIG["Signal pass (fast)"]
    R["5. Reconcile poll (HTTP, slow)"] -->|"replaceAll"| SNAP
    SNAP --> REC["Reconcile pass (full)"]
    SIG --> ACT["get*ForAction (HTTP, on demand)"]
    REC --> ACT
    BUF -->|"advance afterKey"| SUB
```

### Cursor semantics

- `afterKey` is **exclusive** — items strictly **after** the key (same as `messageList.fetchMessagesStrictlyAfter`).
- Pin the cursor so the subscription stays near-empty until something new happens (`subscribeNewMessages` in the webapp uses the same idea).

---

## Consumer pattern: working snapshot

Reusable best practice for any feed that has **incremental + reconcile** channels sharing a snapshot row shape.

### What it is

A `Map<rowKey, SnapshotRow>` held in the daemon process:

- **Reconcile poll** calls `replaceAll(rows)` from `list*ForReconcile` — Convex is authoritative.
- **Each incremental signal** calls `mergeSignal(signal)` — patch volatile fields the signal carries; **preserve** fields the signal omits (e.g. `lastSeenAt`, `createdAt`).
- **Restart** — snapshot is empty until the next hydrate/reconcile; no disk persistence.

This is **not** a local task store. It is a **working set** between reconcile ticks so incremental signals can drive handlers without refetching the full reconcile list.

### Row key

Pick a stable key for one logical row in the feed:

```typescript
// task monitor: one row per (taskId, role)
function rowKey(taskId: string, role: string): string {
  return `${taskId}:${role}`;
}
```

Use the same key in `IncrementalFeedDef.itemKey` (signal cursor / dedupe) and in the snapshot map.

### Merge rules

| Source        | Updates                                                               | Preserves from existing snapshot row                          |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Signal**    | Fields on the signal DTO (status, config deltas, `lastSeenAction`, …) | Timing / heartbeat fields intentionally excluded from signals |
| **Reconcile** | Entire row from `list*ForReconcile`                                   | — (full replace)                                              |

If `mergeSignal` returns `undefined` (no base row), **cold hydrate**: one `list*ForReconcile` fetch, `replaceAll`, merge again. New tasks should be rare on the signal path; avoid refetching on every signal.

### Split handler passes

Do not run the same handler logic on signal and reconcile. Split by what each channel can know:

| Pass          | Trigger                 | Scope                                | Typical actions                                   |
| ------------- | ----------------------- | ------------------------------------ | ------------------------------------------------- |
| **Signal**    | WS `onItem` after patch | One row (or small batch from buffer) | Event-driven: inject, revive, config react        |
| **Reconcile** | HTTP poll timer         | Full snapshot                        | Timing / staleness: idle nudge, rows signals omit |

Example (task monitor):

- **Signal pass** — revive + native inject (needs `lastSeenAction`, status, PID; compares with local agent slots).
- **Reconcile pass** — above plus CLI nudge (needs `createdAt` vs `participant.lastSeenAt`).

Define `pass: 'signal' | 'reconcile'` on your processor and gate branches explicitly.

### Local vs backend state

| Concern                                       | Where it lives                                   |
| --------------------------------------------- | ------------------------------------------------ |
| Row lifecycle, assignment, participant record | Convex (`list*ForReconcile`, action fetch)       |
| “Already delivered / in-flight” dedupe        | Daemon-only ledger (e.g. `NativeDeliveryLedger`) |
| Process alive, harness session                | Daemon `agentMgr` slots                          |
| Working snapshot rows between reconciles      | Snapshot map                                     |

**Rule:** Convex wins on every reconcile. Local state wins only for machine-specific facts (PID, session, delivery ledger).

### Skeleton (new feed)

```typescript
const snapshot = new FeedSnapshot(); // replaceAll + mergeSignal + get

// Reconcile poll
onResult: (result) => {
  const rows = result?.items ?? [];
  snapshot.replaceAll(rows);
  runHandlerPass(snapshot.values(), 'reconcile');
};

// Incremental signal
onItem: ({ item: signal, ack }) => {
  ack();
  let row = snapshot.mergeSignal(signal);
  if (!row) {
    await hydrateSnapshotFromReconcileList();
    row = snapshot.mergeSignal(signal) ?? snapshot.get(signal.id, signal.scope);
  }
  if (row) runHandlerPass([row], 'signal');
};

// Action
if (shouldAct(row)) {
  const full = await fetchForAction(row.id, …);
  …
}
```

Extract `FeedSnapshot` to `<feed>-snapshot.ts` with unit tests for merge/replace/cold-miss.

---

## Two channels

| Channel         | Transport        | Carries                                   | Example                                                    |
| --------------- | ---------------- | ----------------------------------------- | ---------------------------------------------------------- |
| **Incremental** | WS `onUpdate`    | Status, config, action changes (deltas)   | `subscribeAssignedTaskSignalsSince`                        |
| **Reconcile**   | HTTP poll (slow) | Fields excluded from signal `revisionKey` | `listAssignedTasksForReconcile` for `lastSeenAt` staleness |

Do not put pure heartbeat fields in `revisionKey`; let reconcile handle them. Document which fields are signal-only vs reconcile-only for each feed.

---

## Anti-patterns

| Avoid                                                                                                 | Why                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `onUpdate` on a query that returns large blobs                                                        | Bandwidth explosion on every invalidation                           |
| Fixed-interval poll for the incremental tail                                                          | Idle invocation cost                                                |
| **Refetch full `list*ForReconcile` on every signal** when the signal payload + snapshot patch suffice | Defeats the purpose of incremental subscribe                        |
| **Persistent daemon mirror** of Convex rows (disk or long-lived cache as source of truth)             | Drift from webapp / other machines; reintroduces snapshot-sync bugs |
| Advancing subscribe cursor in handlers                                                                | Racey; belongs in `subscribe-loop`                                  |
| Skipping initial hydrate + cursor seed                                                                | Replay or missed state on subscribe start                           |
| Same handler pass for signal and reconcile without gating                                             | Nudge/timing logic on incomplete rows; or redundant work            |
| Naming reconcile snapshot "lite" and assuming cheaper DB reads                                        | Response shaping only; server may still read full docs              |

---

## Backend conventions

| Query                      | Purpose                                               | Transport                   |
| -------------------------- | ----------------------------------------------------- | --------------------------- |
| `subscribe*Since`          | `{ afterKey, limit }` → `{ items, highKey, hasMore }` | WS `onUpdate` (incremental) |
| `list*ForReconcile`        | Current rows without large blobs in response          | HTTP hydrate + reconcile    |
| `get*ForAction` (optional) | One row with blobs for side effects                   | HTTP on demand              |

**Payload rules:**

1. Incremental signal rows are **small** — IDs and volatile fields only.
2. Blobs only in the action query.
3. `revisionKey` from meaningful changes only; exclude noise (e.g. pure `lastSeenAt` ticks).
4. Prefer index-backed cursor scans.

### Signal projection tables (future backend optimization)

If the subscribe query re-runs too often because it reads high-churn tables, write signals to a **projection table** on meaningful mutations and subscribe to that table instead. Consumer snapshot pattern stays the same.

---

## CLI framework (transport)

**Location:** `packages/cli/src/infrastructure/incremental-sync/`

| Module                | Responsibility                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| `types.ts`            | `FeedPage`, `IncrementalFeedDef`, `SubscribeQueryTarget`, handler types |
| `message-buffer.ts`   | FIFO queue, dedupe, bounded size                                        |
| `subscribe-loop.ts`   | Cursor-pinned `onUpdate`, drain `hasMore`, re-subscribe                 |
| `resolve-high-key.ts` | Derive `afterKey` from a page                                           |
| `feed-runtime.ts`     | `runIncrementalSubscribeLive`, `runReconcilePollLive`                   |
| `feeds/<name>.ts`     | Feed def + subscribe target                                             |

### Wiring a new feed

**Backend**

1. `subscribe*Since` (incremental) + `list*ForReconcile` (+ optional `get*ForAction`).
2. Integration spec: cursor exclusivity, no blobs in incremental path, heartbeat does not emit signal (if applicable).

**Transport**

3. `feeds/<your-feed>.ts` — `IncrementalFeedDef`, `SubscribeQueryTarget`, buffer limit.
4. `runIncrementalSubscribeLive` + `runReconcilePollLive` in the subscriber.

**Consumer**

5. `<your-feed>-snapshot.ts` — `replaceAll`, `mergeSignal`, row key, merge tests.
6. Split `signal` / `reconcile` handler passes; document which fields each pass needs.
7. Cold hydrate only when `mergeSignal` misses a base row.
8. Action fetch only inside the branch that performs the side effect.

---

## Example: assigned task monitor

```
Initial hydrate (HTTP)                    Reconcile poll (~15s, HTTP)
listAssignedTasksForReconcile  ──► replaceAll(snapshot)
         │
Seed cursor (HTTP) ──► subscribeAssignedTaskSignalsSince (WS, incremental)
         │
         ▼
onItem: mergeSignal(snapshot) ──► processTasksUpdate([row], 'signal')
         │                              revive + inject
         │
Reconcile: replaceAll(snapshot) ──► processTasksUpdate(all, 'reconcile')
                                       + nudge (needs lastSeenAt / createdAt)
         │
         ▼ on action only
getAssignedTaskForAction (full task.content)
```

| Piece              | Location                                     |
| ------------------ | -------------------------------------------- |
| Incremental query  | `machines.subscribeAssignedTaskSignalsSince` |
| Reconcile snapshot | `machines.listAssignedTasksForReconcile`     |
| Action fetch       | `machines.getAssignedTaskForAction`          |
| Backend core       | `assigned-tasks-core.ts`                     |
| Feed def           | `feeds/assigned-task-signals.ts`             |
| Consumer           | `task-monitor.ts`                            |
| Working snapshot   | `task-monitor-snapshot.ts`                   |

Signal buffer: max 200, dedupe on. Subscribe page limit: 50. Reconcile interval: 15s (matches idle nudge threshold).

---

## Testing

| Layer                     | Where                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| Transport                 | `packages/cli/src/infrastructure/incremental-sync/*.test.ts`     |
| Snapshot merge/replace    | `<feed>-snapshot.test.ts`                                        |
| Backend cursor / payloads | `services/backend/tests/integration/subscribe-*-signals.spec.ts` |
| Handler predicates        | Co-located `*.test.ts` next to logic                             |

Prove: cursor exclusivity, no blob in incremental path, signal omitted fields do not advance cursor, snapshot merge preserves reconcile-only fields.

---

## Related patterns in the repo

| Pattern                             | Location                                  |
| ----------------------------------- | ----------------------------------------- |
| Cursor-pinned message tail (webapp) | `messageList.ts` — `subscribeNewMessages` |
| Reactive pending work (small set)   | `file-tree-subscription.ts`               |
| Subscribe + reconcile poll          | `observed-sync.ts`                        |
| Daemon de-duplication ledger        | `commit-detail-sync.ts` — `seenShas`      |

---

## Checklist (new feed)

**Backend**

- [ ] `subscribe*Since` — small incremental deltas, exclusive `afterKey`
- [ ] `list*ForReconcile` — hydrate + reconcile snapshot (blobs omitted from response)
- [ ] `get*ForAction` (if blobs) — only for side effects
- [ ] `revisionKey` excludes fields handled by reconcile
- [ ] Integration tests for cursor, payload shape, heartbeat contract

**Transport**

- [ ] `feeds/<name>.ts` + `runIncrementalSubscribeLive` with `wsClient`
- [ ] Initial hydrate + cursor seed before subscribe
- [ ] No fixed-interval poll on the incremental tail
- [ ] `subscribe-loop` handles `hasMore`

**Consumer**

- [ ] `<name>-snapshot.ts` with `replaceAll` + `mergeSignal` + tests
- [ ] Signal pass vs reconcile pass documented and gated
- [ ] `onItem` patches snapshot; no full reconcile refetch unless cold hydrate
- [ ] Reconcile poll `replaceAll` before full pass
- [ ] Local ledger / slots only for machine-specific dedupe and health

---

## Follow-up improvements

| Item                        | Description                                                                    |
| --------------------------- | ------------------------------------------------------------------------------ |
| **Signal projection table** | Backend: subscribe reads a projection table instead of live participant scans. |
| **Targeted action fetch**   | Index-backed `get*ForAction` instead of full collect.                          |
| **Additional feeds**        | Commands, events, etc. — same transport + snapshot consumer shape.             |
| **Parallel delivery mode**  | Optional concurrent workers in `MessageBuffer` when a feed needs it.           |
