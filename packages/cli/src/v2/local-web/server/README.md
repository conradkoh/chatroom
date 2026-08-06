# Local web server (v2 daemon)

HTTP server for the embedded daemon UI — **127.0.0.1 only**, `node:http` (no `ws` dependency).

## Implemented

| File                         | Role                                          |
| ---------------------------- | --------------------------------------------- |
| `create-local-web-server.ts` | `startLocalWebServer` factory + lifecycle     |
| `routes.ts`                  | REST + SSE handlers                           |
| `stream-hub.ts`              | In-memory fan-out for `harness.stream` events |

## Routes

| Method | Path                                   | Description                                               |
| ------ | -------------------------------------- | --------------------------------------------------------- |
| `GET`  | `/health`                              | `{ status: 'ok', service: 'v2-local-web' }`               |
| `GET`  | `/api/harness/history?harness=&limit=` | Historical `harness.stream` lines from `PersistenceStore` |
| `GET`  | `/events/harness-stream`               | SSE live stream (EventSource-compatible)                  |

## Does not belong here

| Kind             | Home instead                                        |
| ---------------- | --------------------------------------------------- |
| React components | `local-web/client/`                                 |
| Event production | `domain/usecase/` + `infrastructure/local/harness/` |
| Convex           | `infrastructure/convex/`                            |

## Binding

Always `host: '127.0.0.1'`. Rejects `0.0.0.0` and other hosts.

## Data sources

1. Live `harness.stream` via `stream-hub` (tapped from `publisher-registry`)
2. Historical rows from `infrastructure/persistence/`
