# Local web server (v2 daemon)

HTTP server for the embedded daemon UI — **127.0.0.1 only**, `node:http` (no `ws` dependency).

## Implemented

| File                         | Role                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `create-local-web-server.ts` | `startLocalWebServer` — HTTP + Socket.IO + static SPA |
| `routes.ts`                  | REST + SSE handlers (legacy; Socket.IO preferred)     |
| `stream-hub.ts`              | In-memory fan-out for `harness.stream` events         |
| `serve-static.ts`            | Serves built SPA from `client/build/`                 |

## Socket.IO events

| Event                      | Direction     | Ack | Description                     |
| -------------------------- | ------------- | --- | ------------------------------- |
| `health.get`               | client→server | yes | Daemon UI health + port         |
| `harness.history`          | client→server | yes | Historical harness stream lines |
| `harness.stream.subscribe` | client→server | yes | Subscribe to live stream        |
| `harness.stream`           | server→client | no  | Live harness stream push        |

See [ERROR_CONVENTIONS.md](../ERROR_CONVENTIONS.md) for ack/error patterns.

## Canonical log viewer data path

The Logs module uses SQLite-backed `logs.history`, `logs.stream`, `logs.dimensions`, and `chatrooms.list` socket events. Harness output flows through `onLogLine` → `AgentProcessManager.logSink` → `createLogServer` → SQLite. The older `harness.stream` stack remains legacy and has no current producers feeding the log viewer.

Additional events: `logs.history` accepts `chatroomId`, `role`, and `harness` filters; `logs.dimensions` returns available dimension values; `chatrooms.list` returns owned chatrooms for filtering.

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
