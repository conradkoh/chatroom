# Local web client (v2 daemon)

React SPA (future) served by `local-web/server/`.

## Belongs here (future)

- Harness log viewer (stdout/stderr tabs, timestamps)
- Session / task status dashboard
- Static assets built into daemon package or served from dev middleware

## Does not belong here

| Kind                     | Home instead                            |
| ------------------------ | --------------------------------------- |
| Direct `domain/` imports | Use HTTP/WebSocket API from server only |
| Convex client            | `apps/webapp/`                          |

## Scaffold status

**README only** — no client implementation in this slice.

## API contract (planned)

- REST: daemon health, active sessions, machine id
- WebSocket: subscribe to `harness.stream` events (same shape as `OutboundEvent`)

## Not the same as

- **`apps/local`** — local dev stack manager
- **`apps/webapp`** — remote Convex-backed chatroom UI
