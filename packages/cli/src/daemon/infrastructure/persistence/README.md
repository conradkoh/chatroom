# Persistence (daemon module)

**SQLite default write sink** and outbox for Convex projection (`node:sqlite` / `DatabaseSync`).

## Implemented

| Module                 | Role                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `schema.ts`            | `SCHEMA_VERSION` + migrations                                            |
| `open-database.ts`     | Open DB, run migrations                                                  |
| `event-store.ts`       | Append-only `OutboundEvent` log                                          |
| `outbox.ts`            | Enqueue pending Convex projection rows (`status: 'pending'`)             |
| `read-model.ts`        | Query `harness.stream` lines for local-web                               |
| `persistence-store.ts` | Facade: `append`, `listHarnessStreamLines`, `listPendingOutbox`, `close` |

## Outbox drain

Append enqueues outbox rows for **non-T0** event types (T0 — `harness.stream` — stays local-only and is never enqueued). Default DB path is `~/.chatroom/daemon/<machineId>/events.sqlite` via `entry/persistence-path.ts` and `entry/start-daemon.ts`.

The drain worker lives in `infrastructure/projection/outbox-drain-worker.ts` and is started from `entry/start-daemon.ts` when `orchestration flags` is set (default off):

| Flag                                                              | Effect                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (unset)                                                           | No drain worker; publisher-registry direct Convex publish (today's behavior)                                                                                               |
| `orchestration flags=1`                                       | Drain worker runs in **shadow** mode — validates that a projection handler exists and marks rows done, **does not** call Convex. Direct publish remains authoritative.     |
| `orchestration flags=1` + `orchestration flags=1` | Drain worker **projects** to Convex via the projection handlers; publisher-registry skips direct Convex publish for covered event types (outbox drain is the sole writer). |

Shadow mode produces **no duplicate Convex writes**: the drain worker validates only, while direct publishers remain the single writer. Cutover hands the write path to the drain worker.

## P2 local read models

`SCHEMA_VERSION = 2` adds orchestration read models under `infrastructure/persistence/read-models/`:

| Table                     | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `read_model_tasks`        | 1:1 `AssignedTaskSnapshotView` rows (task monitor working rows) |
| `read_model_participants` | Participant turn phase / last-seen                              |
| `read_model_agents`       | Spawned agent session rows                                      |
| `read_model_handoffs`     | Pending handoff state                                           |

Flags (both default **off**):

| Flag                                                              | Effect                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orchestration flags=1`                                       | Hydrate read models from Convex on startup; shadow-sync each assigned-task snapshot WS update into `read_model_tasks`. Convex WS remains authoritative for decisions.                                                                                                                                                                                              |
| `orchestration flags=1` + `orchestration flags=1` | Task monitor skips the snapshot WS subscription and sources snapshots from read models (via the snapshot-store provider); restart orchestrator reads deliverable tasks from read models. Signals/presence trigger a pull-refresh from Convex into read models. Cutover requires P1 (`orchestration flags`) for Convex sync of task-status projections. |

Rollback: unset `orchestration flags` (or both P2 flags) — the snapshot WS and Convex query paths resume unchanged.

## P3 handoff local

Flags (both default **off**):

| Flag                                                                     | Effect                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `orchestration flags=1`                                              | (PR D) `chatroom handoff` routes to daemon HTTP instead of `api.messages.handoff`         |
| `orchestration flags=1` + `orchestration flags=1` | (PR D) Native delivery triggered from local handoff event instead of assigned-task signal |

PR A adds `domain/usecase/execute-handoff.ts` — local SQLite transaction + `handoff.completed` outbound event. HTTP server, projection handler, and CLI routing land in PR B–D.

## Does not belong here

| Kind                | Home instead             |
| ------------------- | ------------------------ |
| Convex WS transport | `infrastructure/convex/` |
| Domain types        | `domain/entities/`       |
| UI                  | `local-web/`             |

## Usage

```typescript
import { createPersistenceStore } from './index.js';

const store = createPersistenceStore('/path/to/events.sqlite');
store.append({
  type: 'harness.stream',
  harness: 'h1',
  stream: 'stdout',
  line: '...',
  timestamp: Date.now(),
});
store.close();
```
