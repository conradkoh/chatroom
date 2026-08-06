# Entry layer (v2 daemon)

Composition root — wiring only. **No business logic.**

## Belongs here

| File                     | Role                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `start-daemon.ts`        | Future replacement for `daemon-start/index.ts`                             |
| `event-router.ts`        | `InboundEvent` → use case dispatch                                         |
| `subscriber-registry.ts` | Start/stop all Convex subscribers                                          |
| `publisher-registry.ts`  | Route `OutboundEvent` → publishers; appends to persistence when configured |
| `deps.ts`                | Dependency bag for use cases (publishers + optional persistence)           |

## Does not belong here

| Kind          | Home instead             |
| ------------- | ------------------------ |
| Orchestration | `domain/usecase/`        |
| Convex I/O    | `infrastructure/convex/` |

## ⚠️ Entry cutover is LAST

**Do not wire `start-daemon.ts` into `daemon-start/index.ts` until:**

1. All subscribers normalize and emit `InboundEvent`
2. Event router dispatches every event type
3. Use cases are migrated and tested
4. Publisher registry covers all `OutboundEvent` variants

Until then, v1 `packages/cli/src/commands/machine/daemon-start/index.ts` remains the sole active entry.

## Legacy

`start-daemon.ts` ← `commands/machine/daemon-start/index.ts`
