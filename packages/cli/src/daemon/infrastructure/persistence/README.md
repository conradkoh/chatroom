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

The drain worker lives in `infrastructure/projection/outbox-drain-worker.ts` and is started from `entry/start-daemon.ts` when `DAEMON_ORCHESTRATION_P1` is set (default off):

| Flag                                                              | Effect                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (unset)                                                           | No drain worker; publisher-registry direct Convex publish (today's behavior)                                                                                               |
| `DAEMON_ORCHESTRATION_P1=1`                                       | Drain worker runs in **shadow** mode — validates that a projection handler exists and marks rows done, **does not** call Convex. Direct publish remains authoritative.     |
| `DAEMON_ORCHESTRATION_P1=1` + `DAEMON_ORCHESTRATION_P1_CUTOVER=1` | Drain worker **projects** to Convex via the projection handlers; publisher-registry skips direct Convex publish for covered event types (outbox drain is the sole writer). |

Shadow mode produces **no duplicate Convex writes**: the drain worker validates only, while direct publishers remain the single writer. Cutover hands the write path to the drain worker.

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
