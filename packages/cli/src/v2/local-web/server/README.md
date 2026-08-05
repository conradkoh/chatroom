# Local web server (v2 daemon)

HTTP + WebSocket server for the embedded daemon UI.

## Belongs here (future)

| File (planned)               | Role                                                 |
| ---------------------------- | ---------------------------------------------------- |
| `create-local-web-server.ts` | Factory + lifecycle                                  |
| `routes/`                    | REST handlers (status, sessions, logs)               |
| `websocket-hub.ts`           | Fan-out `harness.stream` events to connected clients |

## Does not belong here

| Kind             | Home instead                                        |
| ---------------- | --------------------------------------------------- |
| React components | `local-web/client/`                                 |
| Event production | `domain/usecase/` + `infrastructure/local/harness/` |
| Convex           | `infrastructure/convex/`                            |

## Scaffold status

`create-local-web-server.ts` is a no-op stub. Routes and WebSocket hub are documented only.

## Binding

Always `host: '127.0.0.1'`. Reject `0.0.0.0` and public interfaces.

## Data sources (planned)

1. Live `OutboundEvent` `harness.stream` from publisher-registry tap
2. Historical rows from `infrastructure/persistence/` once implemented
