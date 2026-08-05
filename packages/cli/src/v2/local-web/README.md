# Local web (v2 daemon)

Localhost-only web UI embedded in the daemon process — **primary sink for full-granularity data**, especially harness stream output (stdout/stderr) that is console-only today.

## Belongs here

| Subfolder | Role                                                   |
| --------- | ------------------------------------------------------ |
| `server/` | HTTP + WebSocket server (`127.0.0.1` only)             |
| `client/` | React SPA (future) — harness log viewer, daemon status |

## Does not belong here

| Kind                 | Home instead      |
| -------------------- | ----------------- |
| Convex remote UI     | `apps/webapp/`    |
| Dev stack manager UI | `apps/local/`     |
| Domain orchestration | `domain/usecase/` |

## Architecture

- Binds to **`127.0.0.1` only** — never `0.0.0.0`
- Server runs inside the daemon process
- Reads from `infrastructure/persistence/` (future) + live WebSocket for stream events
- Domain event for harness output: `OutboundEvent` type **`harness.stream`**

## Security

Localhost binding is a hard requirement. No remote exposure without an explicit future security review.

## Primary v1 feature target

Full harness log viewer with stdout/stderr streams, searchable history once persistence lands.
