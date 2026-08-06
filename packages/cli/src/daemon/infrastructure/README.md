# Infrastructure (v2 daemon)

Adapter layer — transport and machine-local I/O. **No business logic.**

## Belongs here

| Subfolder             | Role                                                |
| --------------------- | --------------------------------------------------- |
| `convex/subscribers/` | Inbound: Convex → `InboundEvent`                    |
| `convex/publishers/`  | Outbound: `OutboundEvent` → Convex mutations        |
| `persistence/`        | SQLite write sink + outbox (future)                 |
| `local/`              | `machine.json`, process spawn, harness SDK (future) |

## Does not belong here

| Kind                            | Home instead                                                  |
| ------------------------------- | ------------------------------------------------------------- |
| Orchestration, branching policy | `domain/usecase/`                                             |
| Event routing                   | `entry/event-router.ts`                                       |
| Registry wiring                 | `entry/subscriber-registry.ts`, `entry/publisher-registry.ts` |

## Dependency rules

- May import `domain/entities/` for normalization types only
- Must not import `domain/usecase/`
- Reuse `packages/cli/src/infrastructure/incremental-sync/` — do not duplicate transport loops

## Event flow

```
Convex → subscribers/ → InboundEvent → entry/event-router → usecase/
usecase/ → OutboundEvent → entry/publisher-registry → publishers/ → Convex
```
