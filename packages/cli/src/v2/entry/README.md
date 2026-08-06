# Entry layer (v2 daemon)

Composition root — wiring only. **No business logic.**

## Belongs here

| File                     | Role                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `start-daemon.ts`        | **`startDaemonV2`** — composition root (persistence, local-web, subscribers, legacy command loop) |
| `persistence-path.ts`    | Resolve `~/.chatroom/daemon/<machineId>/events.sqlite`                                            |
| `default-router-deps.ts` | Empty router hooks for all bounded contexts                                                       |
| `event-router.ts`        | `InboundEvent` → use case dispatch                                                                |
| `subscriber-registry.ts` | Start/stop all 15 Convex subscribers                                                              |
| `publisher-registry.ts`  | Route `OutboundEvent` → publishers; appends to persistence; fans `harness.stream` to `streamHub`  |
| `deps.ts`                | Dependency bag for use cases (publishers, persistence, streamHub)                                 |

## Entry cutover (done)

`daemon-start/index.ts` delegates to `startDaemonV2()`. Strangler pattern:

1. `initDaemon()` — auth, Convex client, machine registration (unchanged)
2. v2 persistence + local-web + 15 subscribers (parallel path)
3. Legacy `startCommandLoopEffect` — command loop + legacy subscriptions (unchanged)
4. `finally` — stop subscribers, local-web, close persistence

Router hooks remain empty `{}` until inbound handler bodies land in future slices.

## Does not belong here

| Kind          | Home instead             |
| ------------- | ------------------------ |
| Orchestration | `domain/usecase/`        |
| Convex I/O    | `infrastructure/convex/` |

## Legacy

`start-daemon.ts` ← `commands/machine/daemon-start/index.ts`
