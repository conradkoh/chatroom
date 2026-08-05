# Persistence (v2 daemon)

Future **SQLite default write sink** and outbox for Convex projection.

## Belongs here (future)

- Append-only event log for `OutboundEvent` (especially `harness.stream`)
- Outbox table for reliable Convex publisher retries
- Read APIs for `local-web/server/` historical queries

## Does not belong here

| Kind                | Home instead             |
| ------------------- | ------------------------ |
| Convex WS transport | `infrastructure/convex/` |
| Domain types        | `domain/entities/`       |
| UI                  | `local-web/`             |

## Scaffold status

**No implementation in this slice.** README + folder only. Local-web may read from persistence once built; until then, harness stream events are console-only in v1.

## Naming (planned)

- `event-store.ts` — append `OutboundEvent`
- `outbox.ts` — pending Convex projections
- `read-model.ts` — queries for local-web
