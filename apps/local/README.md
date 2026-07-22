# @workspace/local

Local development process manager for the Chatroom monorepo.

## Usage

From the repo root:

```bash
pnpm local
```

Opens a browser UI — no child processes start until you click **Start Stack**.

## Configuration

### Launch-time (CLI / env)

| Flag             | Env var              | Default | Description          |
| ---------------- | -------------------- | ------- | -------------------- |
| `--manager-port` | `LOCAL_MANAGER_PORT` | 3847    | Local dev manager UI |

### Runtime (UI)

Configured after launching `pnpm local` via the setup screen:

| Setting      | Description                                           |
| ------------ | ----------------------------------------------------- |
| Backend mode | Local Convex or Hosted Convex                         |
| Webapp port  | Next.js webapp port                                   |
| Convex port  | Convex dev HTTP port (local mode only)                |
| Convex URL   | Full deployment URL (hosted mode, e.g. .convex.cloud) |

Default values loaded from `services/backend/.env.local` and `apps/webapp/.env.local`.

```bash
# Custom manager port
pnpm local -- --manager-port 4000
```

## Lifecycle

1. **Idle** — `pnpm local` opens setup screen only
2. **Starting** — Convex (if local) starts, health check runs, then webapp + daemon
3. **Running** — Dashboard with logs, restart, stop
4. **Stopping** — SIGTERM all processes, return to idle

### Backend modes

| Mode   | Convex spawn   | Health check                | URL source                |
| ------ | -------------- | --------------------------- | ------------------------- |
| Local  | `pnpm ... dev` | `GET /version` on localhost | `http://127.0.0.1:{port}` |
| Hosted | Skipped        | `GET /version` on cloud URL | From `.env.local`         |

## Prerequisites

- Run `pnpm setup` at least once so `services/backend/.env.local` exists with a `CONVEX_URL`.
- Run `pnpm install`.

## Browser validation

After `pnpm local`:

1. Open http://localhost:3847 — setup screen should load
2. Verify hosted mode defaults (convex.cloud URL, correct port from .env.local)
3. Click **Start Stack** — dashboard shows processes starting
4. Verify convex shows "Hosted" (skipped), webapp + daemon reach Running
5. Click **Stop Stack** — returns to setup screen

## Shutdown

Press `Ctrl+C` to stop all managed processes and shut down the manager.

## Implementation

- Server: Node.js HTTP + `ws` WebSocket server with Vite middleware mode.
- Client: React SPA served by Vite, Tailwind v4 + shadcn dark theme.
- Process supervision: `child_process.spawn` with process-group kill on Unix.
- Log buffer: in-memory ring buffer (2000 lines per process).
- Health check: HTTP polling of `GET /version` on Convex URL (1s interval, 120s timeout).
