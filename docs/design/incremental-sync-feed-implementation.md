# Incremental Sync Feed — Implementation Plan

**Status:** Complete (branch `feat/incremental-sync-task-monitor`)  
**Branch:** `feat/incremental-sync-task-monitor`  
**Design:** [incremental-sync-feed.md](./incremental-sync-feed.md)  
**Bug:** `machines:getAssignedTasks` reactive subscription re-pushes full snapshots (including `task.content`) on every participant heartbeat (~30s/role).

All phases ship on one branch. Work proceeds in order; each phase has concrete file targets and acceptance criteria.

---

## Problem summary

| Layer        | Issue                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| Transport    | `wsClient.onUpdate(getAssignedTasks)` — Convex re-pushes on any dependency change  |
| Payload      | Full `task.content` embedded for every active task on every push                   |
| Dependencies | Query reads `chatroom_participants`; `lastSeenAt` heartbeats invalidate constantly |
| Consumer     | `task-monitor.ts` scans full task array for nudge / revive / native inject         |

## Target architecture

Two channels, one framework:

```
┌─────────────────────────────────────────────────────────────┐
│  packages/cli/src/infrastructure/incremental-sync/          │
│                                                             │
│  Signal feed (poll ~2s)          Reconcile poll (~15s)      │
│  pollAssignedTaskSignalsSince    listAssignedTasksLite      │
│  small deltas                    no task.content            │
│           │                              │                  │
│           └──────────┬───────────────────┘                  │
│                      ▼                                      │
│           processTasksUpdate (existing logic)               │
│                      │ on nudge / revive / inject           │
│                      ▼                                      │
│           getAssignedTaskForAction (fat one-shot)           │
└─────────────────────────────────────────────────────────────┘
```

**Decision defaults**

| Question                              | Choice                                                           |
| ------------------------------------- | ---------------------------------------------------------------- |
| Reconcile interval                    | 15s (matches `PENDING_IDLE_NUDGE_MS`)                            |
| Signal poll interval                  | 2s                                                               |
| Participant heartbeats in signal poll | Exclude pure `lastSeenAt` ticks; reconcile handles idle          |
| Cursor persistence v1                 | Skip — handlers idempotent via `NudgeCooldown` + delivery ledger |
| `getAssignedTasks`                    | Deprecated after migration; removed in Phase 4                   |

---

## Phase 1 — CLI framework (no production wiring)

**Goal:** Reusable `incremental-sync` package inside CLI. Zero daemon wiring.

### Files to create

```
packages/cli/src/infrastructure/incremental-sync/
  types.ts                 # StreamKey, PollPage, configs, handler types
  message-buffer.ts        # FIFO/standard queue, dedupe, bounded size
  message-buffer.test.ts
  poll-loop.ts             # Cursor advance, interval, error backoff
  poll-loop.test.ts
  feed-runtime.ts          # runIncrementalFeed, runReconcilePoll
  feed-runtime.test.ts
  layers.ts                # PollClock Context.Tag + test layer
  index.ts                 # Public exports
```

### `types.ts`

```typescript
export type StreamKey = string;

export interface PollPage<TItem> {
  readonly items: readonly TItem[];
  readonly highKey: StreamKey | null;
  readonly hasMore: boolean;
}

export interface PollRequest<TArgs> {
  readonly args: TArgs;
  readonly afterKey: StreamKey | null;
  readonly limit: number;
}

export interface IncrementalFeedDef<TItem, TArgs> {
  readonly name: string;
  readonly poll: (req: PollRequest<TArgs>) => Promise<PollPage<TItem>>;
  readonly itemKey: (item: TItem) => StreamKey;
  readonly itemToKey?: (item: TItem) => StreamKey;
}

export type DeliveryMode = 'fifo' | 'standard';

export interface BufferConfig {
  readonly maxSize: number;
  readonly deliveryMode: DeliveryMode;
  readonly dedupe?: boolean;
  readonly dedupeTtlMs?: number;
  readonly maxConcurrency?: number;
}

export interface PollLoopConfig {
  readonly intervalMs: number;
  readonly limit: number;
  readonly backoff: { readonly initialMs: number; readonly maxMs: number };
}

export interface FeedHandlerContext<TItem> {
  readonly item: TItem;
  readonly feedName: string;
  readonly ack: () => void;
  readonly nack: (opts?: { requeue?: boolean }) => void;
}

export type FeedItemHandler<TItem, R = void> = (
  ctx: FeedHandlerContext<TItem>
) => Effect.Effect<R, unknown, never>;
```

### `message-buffer.ts` behaviour

- `enqueue(items)` — skip duplicates per `itemKey` when `dedupe: true` (in buffer, in-flight, or recently acked within `dedupeTtlMs`)
- `dequeue()` — fifo: lowest key; standard: FIFO head
- `maxSize` — drop oldest unacked with console warning
- `ack` / `nack({ requeue })` — managed by feed-runtime worker

### `poll-loop.ts` behaviour

- Imperative `poll()` only — never `onUpdate`
- `afterKey` exclusive cursor; advance on non-empty page via `highKey` or max `itemToKey`
- When `hasMore: true`, immediately poll again before sleeping
- On error: exponential backoff, do not advance cursor
- `runReconcilePoll` — simpler variant: fixed-interval `poll()` with full handler (no buffer)

### `feed-runtime.ts`

- `runIncrementalFeed(opts)` → `{ stop, buffer?, stream? }`
- Fork poll fiber + worker fiber(s)
- `stop()` interrupts both fibers

### Tests

| File                     | Cases                                                    |
| ------------------------ | -------------------------------------------------------- |
| `message-buffer.test.ts` | fifo ordering, dedupe, maxSize eviction, requeue on nack |
| `poll-loop.test.ts`      | cursor advance, hasMore paging, backoff on error         |
| `feed-runtime.test.ts`   | mocked poll pages → handler invocations, stop interrupts |

### Acceptance

- [x] `pnpm test --filter=cli` passes for new tests
- [x] Production wiring in task-monitor
- [x] Design doc Phase 0 scaffold checkbox updated

---

## Phase 2 — Backend queries

**Goal:** Replace fat subscription payload with slim imperative queries.

### Files to create / modify

```
services/backend/src/domain/usecase/machine/
  get-assigned-tasks.ts              # refactor: split lite / action / signals
  get-assigned-tasks.test.ts         # unit tests for signal cursor logic
  poll-assigned-task-signals.ts      # signal use case
  list-assigned-tasks-lite.ts        # lite snapshot use case
  get-assigned-task-for-action.ts    # fat one-shot use case

services/backend/convex/machines.ts  # expose new queries
services/backend/tests/integration/
  poll-assigned-task-signals.spec.ts # convex integration tests
```

### 2a. `listAssignedTasksLite`

Same pairing logic as `getAssignedTasksForMachine` but **omits `taskContent`**.

```typescript
export interface AssignedTaskLiteView {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  status: string;
  assignedTo: string | undefined;
  updatedAt: number;
  createdAt: number;
  agentConfig: {
    /* same as AssignedTaskView */
  };
  participant?: { lastSeenAction; lastSeenAt; lastStatus };
}
```

Convex: `machines.listAssignedTasksLite`

### 2b. `getAssignedTaskForAction`

```typescript
// Args: sessionId, machineId, taskId, role
// Returns: AssignedTaskView | null (includes taskContent)
```

Convex: `machines.getAssignedTaskForAction`

### 2c. `pollAssignedTaskSignalsSince`

```typescript
export type AssignedTaskSignalType = 'task' | 'agent_config' | 'participant';

export interface AssignedTaskSignal {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  status: 'pending' | 'acknowledged' | 'in_progress';
  signalType: AssignedTaskSignalType;
  revisionKey: string; // `${maxTs}:${taskId}:${role}` — monotonic per row
  compressContext?: 'new_session' | 'none';
  lastSeenAction?: string | null;
  spawnedAgentPid?: number;
  desiredState?: string;
}

export interface PollAssignedTaskSignalsResult {
  items: AssignedTaskSignal[];
  highKey: string | null;
  hasMore: boolean;
}
```

**Signal emission rules**

| Source       | Emit when                                                                     |
| ------------ | ----------------------------------------------------------------------------- |
| Task         | status change, new active task, `updatedAt` change                            |
| Agent config | `spawnedAgentPid`, `desiredState`, `circuitState` change                      |
| Participant  | `lastSeenAction` or `lastStatus` change — **not** pure `lastSeenAt` heartbeat |

**Cursor:** `afterKey` exclusive. Backend scans machine's chatrooms, returns signals with `revisionKey > afterKey`, sorted ascending, limited.

Convex: `machines.pollAssignedTaskSignalsSince`

### 2d. Deprecation

Mark `getAssignedTasks` with `@deprecated` JSDoc — removed Phase 4.

### Acceptance

- [x] Convex integration tests for cursor exclusivity and limit
- [x] Poll response contains no `task.content`
- [x] `pnpm test --filter=backend` passes

---

## Phase 3 — Task monitor migration

**Goal:** Remove `onUpdate(getAssignedTasks)` from daemon.

### Files to create / modify

```
packages/cli/src/infrastructure/incremental-sync/feeds/
  assigned-task-signals.ts           # IncrementalFeedDef wrapper

packages/cli/src/commands/machine/daemon-start/
  task-monitor.ts                    # migrate to poll-based
  task-monitor.test.ts               # update
  task-monitor-revive.test.ts        # update
  daemon-subscriptions-d4.test.ts    # assert no onUpdate(getAssignedTasks)
  command-loop.ts                    # wire new effect name
```

### `task-monitor.ts` changes

1. Rename `startTaskMonitorSubscriptionEffect` → `startTaskMonitorEffect`
2. Remove `wsClient` parameter — use `session.backend.query` only
3. **Reconcile loop** (15s): `listAssignedTasksLite` → `processTasksUpdate`
4. **Signal feed** (2s): `assignedTaskSignalsFeed` → trigger immediate reconcile on signal
5. **Action path:** before nudge/revive/inject, `getAssignedTaskForAction` for `taskContent`
6. Initial hydrate: one `listAssignedTasksLite` on start before loops

### `processTasksUpdate` signature

Change input from `AssignedTaskView[]` to `AssignedTaskLiteView[]` for routine scans; action handlers fetch fat view when needed.

Update downstream:

- `task-monitor-logic.ts` — accept lite view (no `taskContent` in predicates)
- `native-task-delivery-coordinator.ts` — fetch content at inject time
- `native-task-injector.ts` — receive fat view from caller

### Acceptance

- [x] No `wsClient.onUpdate(api.machines.getAssignedTasks)` in codebase
- [x] Existing task-monitor tests pass (updated mocks)
- [x] `pnpm test --filter=cli` passes

---

## Phase 4 — Cleanup

- [x] `getAssignedTasks` marked `@deprecated` (no CLI callers remain)
- [x] Update [incremental-sync-feed.md](./incremental-sync-feed.md) checkboxes
- [x] Update `task-monitor.ts` file header comment
- [ ] `pnpm typecheck` + full test pass (run before merge)

---

## Ticket checklist

```
Phase 1
[x] types.ts
[x] message-buffer.ts + tests
[x] poll-loop.ts + tests
[x] feed-runtime.ts + tests
[x] layers.ts + index.ts

Phase 2
[x] listAssignedTasksLite use case + convex query
[x] getAssignedTaskForAction use case + convex query
[x] pollAssignedTaskSignalsSince use case + convex query
[x] Integration tests

Phase 3
[x] feeds/assigned-task-signals.ts
[x] task-monitor migration
[x] task-monitor-logic / native inject updates
[x] command-loop + daemon test updates

Phase 4
[x] Deprecate getAssignedTasks (kept for debugging)
[x] Design doc checkboxes
```

---

## References

- `packages/cli/src/commands/machine/daemon-start/task-monitor.ts` — current subscription consumer
- `services/backend/src/domain/usecase/machine/get-assigned-tasks.ts` — current fat query
- `services/backend/convex/messageList.ts` — cursor tail precedent
- `packages/cli/src/commands/machine/daemon-start/file-tree-subscription.ts` — prior bandwidth fix
