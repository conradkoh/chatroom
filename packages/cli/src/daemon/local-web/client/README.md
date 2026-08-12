# Local web client (v2 daemon)

React SPA served by `local-web/server/` — embedded daemon UI.

## Stack

- Vite + React 19
- shadcn (Base UI) + Tailwind v4
- TanStack React Query
- Socket.IO client (see `ERROR_CONVENTIONS.md`)

## Modules

| Module | Path                   | Status      |
| ------ | ---------------------- | ----------- |
| Logs   | `client/modules/logs/` | Placeholder |

## Build

```bash
cd packages/cli && bun run build:local-web
```

Output: `client/build/` — served as static assets by the daemon HTTP server.

## Dev

Run `bun run build:local-web` after UI changes; the daemon serves the built bundle from `client/dist/`.
