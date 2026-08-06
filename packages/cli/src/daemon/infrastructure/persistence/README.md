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

Append enqueues outbox rows. Default DB path is `~/.chatroom/daemon/<machineId>/events.sqlite` via `entry/persistence-path.ts` and `entry/start-daemon.ts`. A background worker to drain pending rows to Convex is not yet wired.

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
