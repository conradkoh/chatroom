# Repository layer (daemon module)

Read-side adapters over SQLite persistence. Use cases depend on repository interfaces — not on `PersistenceStore` directly.

## Implemented

| Module                         | Role                                  |
| ------------------------------ | ------------------------------------- |
| `harness-stream-repository.ts` | Read harness stream lines from SQLite |

## Does not belong here

| Kind            | Home instead                  |
| --------------- | ----------------------------- |
| Write path      | `infrastructure/persistence/` |
| Domain types    | `domain/entities/`            |
| Socket handlers | `infrastructure/socket/`      |
