# Local web client (v2 daemon)

React SPA served by `local-web/server/` — embedded daemon UI.

## Stack

- Vite + React 19
- shadcn (Base UI) + Tailwind v4
- TanStack React Query
- Socket.IO client (see `ERROR_CONVENTIONS.md`)

## Modules

| Module | Path                   | Status                                               |
| ------ | ---------------------- | ---------------------------------------------------- |
| Logs   | `client/modules/logs/` | Implemented — thin page wiring to `components/logs/` |

## Components

| Area               | Path                                            |
| ------------------ | ----------------------------------------------- |
| Layout             | `client/components/layout/`                     |
| Logs               | `client/components/logs/`                       |
| LogFiltersBar      | `client/components/logs/LogFiltersBar.tsx`      |
| LogDetailPanel     | `client/components/logs/LogDetailPanel.tsx`     |
| LogDimensionBadges | `client/components/logs/LogDimensionBadges.tsx` |
| UI                 | `client/components/ui/`                         |

## Build

```bash
cd packages/cli && bun run build:local-web
```

Output: `client/build/` — served as static assets by the daemon HTTP server.

## Dev

Run `bun run build:local-web` after UI changes; the daemon serves the built bundle from `client/dist/`.
