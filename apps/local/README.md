# @workspace/local

Local development process manager for the Chatroom monorepo.

## Usage

From the repo root:

```bash
pnpm local
```

Opens a browser UI at **http://localhost:3847** showing three managed processes:

| Process             | Command                                                    |
| ------------------- | ---------------------------------------------------------- |
| **Convex (local)**  | `pnpm --filter @workspace/backend dev`                     |
| **Webapp**          | `turbo run build --filter=@workspace/webapp && next start` |
| **Chatroom Daemon** | `chatroom machine daemon start`                            |

## Configuration

| Flag             | Env var              | Default | Description          |
| ---------------- | -------------------- | ------- | -------------------- |
| `--manager-port` | `LOCAL_MANAGER_PORT` | 3847    | Local dev manager UI |
| `--webapp-port`  | `LOCAL_WEBAPP_PORT`  | 3000    | Next.js webapp       |
| `--convex-port`  | `LOCAL_CONVEX_PORT`  | 3210    | Convex local backend |

```bash
# Custom ports
pnpm local -- --manager-port 4000 --webapp-port 3001 --convex-port 3211

# Via env
LOCAL_WEBAPP_PORT=3001 pnpm local
```

## Startup sequence

1. **Convex** starts (`pnpm --filter @workspace/backend dev`)
2. Health check polls `GET /version` on the convex URL until ready (or 120s timeout)
3. **Webapp** + **Daemon** start once Convex is healthy (turbo build, then start)

## Prerequisites

- Run `pnpm setup` at least once so `services/backend/.env.local` exists with a `CONVEX_URL`.
- Run `pnpm install`.

## UI

- **Sidebar**: process list with status indicators (green = running, yellow = starting, grey = stopped/pending, red = crashed). Convex shows health badge (healthy/checking/unhealthy). Port numbers displayed below connection status.
- **Main panel**: scrolling log viewer for the selected process with stream badges and timestamps.
- **Restart button** (appears on hover): restarts an individual process. Restarting Convex re-runs the health gate.

## Shutdown

Press `Ctrl+C` to stop all managed processes and shut down the manager.

## Implementation

- Server: Node.js HTTP + `ws` WebSocket server with Vite middleware mode.
- Client: React SPA served by Vite, Tailwind v4 + shadcn dark theme.
- Process supervision: `child_process.spawn` with process-group kill on Unix.
- Log buffer: in-memory ring buffer (2000 lines per process).
- Health check: HTTP polling of `GET /version` on Convex URL (1s interval, 120s timeout).
