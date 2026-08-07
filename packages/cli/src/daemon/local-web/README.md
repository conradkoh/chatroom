# Local web (v2 daemon)

Localhost-only web UI embedded in the daemon process — **primary sink for full-granularity data**, especially harness stream output (stdout/stderr) that is console-only today.

## Belongs here

| Subfolder | Role                                                   |
| --------- | ------------------------------------------------------ |
| `server/` | HTTP server (`127.0.0.1` only) — REST + SSE            |
| `client/` | React SPA (future) — harness log viewer, daemon status |

## Does not belong here

| Kind                 | Home instead      |
| -------------------- | ----------------- |
| Convex remote UI     | `apps/webapp/`    |
| Dev stack manager UI | `apps/local/`     |
| Domain orchestration | `domain/usecase/` |

## Architecture

- Binds to **`127.0.0.1` only** — never `0.0.0.0`
- Server runs inside the daemon process (not wired in `start-daemon.ts` yet)
- **Live stream:** SSE at `/events/harness-stream` via `stream-hub` fan-out
- **History:** `GET /api/harness/history` reads from `PersistenceStore.listHarnessStreamLines`
- Domain event for harness output: `OutboundEvent` type **`harness.stream`**

## Security

Localhost binding is a hard requirement. No remote exposure without an explicit future security review.

## Primary v1 feature target

Full harness log viewer with stdout/stderr streams, searchable history via persistence + live SSE.
