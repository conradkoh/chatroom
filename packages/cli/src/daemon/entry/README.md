# Entry layer (daemon module)

Composition root — wiring only. **No business logic.**

## Task discovery

TaskService owns native task delivery composition. Entry only calls that facade as composition wiring.

Task inbox startup is composed in `entry/task-inbox-runtime.ts` and registers active workspace rooms with the task service. Workspace membership and workspace-scoped watchers are initialized from the daemon's startup reconcile.

## Belongs here

| File                     | Role                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `start-daemon.ts`        | **`startDaemon`** — composition root (persistence, local-web, subscribers, daemon runtime)       |
| `daemon-runtime.ts`      | Heartbeat, worker init, inbound registry handlers, shutdown/signals (replaces command loop)      |
| `command-dispatch.ts`    | Command event dispatch + dedup tracker                                                           |
| `init-daemon.ts`         | Auth, Convex client, machine registration, harness registry init                                 |
| `persistence-path.ts`    | Resolve `~/.chatroom/daemon/<machineId>/events.sqlite`                                           |
| `default-router-deps.ts` | Router hooks for all bounded contexts (assigned task, harness, command, file, git, enhancer, …)  |
| `event-router.ts`        | `InboundEvent` → use case dispatch                                                               |
| `subscriber-registry.ts` | Start/stop all 13 Convex subscribers                                                             |
| `publisher-registry.ts`  | Route `OutboundEvent` → publishers; appends to persistence; fans `harness.stream` to `streamHub` |
| `deps.ts`                | Dependency bag for use cases (publishers, persistence, streamHub)                                |

## Does not belong here

| Kind          | Home instead             |
| ------------- | ------------------------ |
| Orchestration | `domain/usecase/`        |
| Convex I/O    | `infrastructure/convex/` |
