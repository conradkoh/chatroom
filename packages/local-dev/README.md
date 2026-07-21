# @workspace/local-dev

Local development process manager for the Chatroom monorepo.

## Usage

From the repo root:

```bash
pnpm local
```

Opens a browser UI at **http://localhost:3847** showing three managed processes:

| Process             | Command                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Convex (local)**  | `npx convex dev` (from `services/backend`)                                              |
| **Webapp**          | `pnpm build && next start -p 3000` (from `apps/webapp`)                                 |
| **Chatroom Daemon** | `chatroom machine daemon start` (with `CHATROOM_CONVEX_URL` and `CHATROOM_WEB_URL` set) |

## Prerequisites

- Run `pnpm setup` at least once so `services/backend/.env.local` exists with a `CONVEX_URL`.
- Run `pnpm install`.

## UI

- **Sidebar**: process list with status indicators (green = running, yellow = starting, grey = stopped, red = crashed).
- **Main panel**: scrolling log viewer for the selected process with `[OUT]` / `[ERR]` stream badges and timestamps.
- **Restart button** (appears on hover): restarts an individual process.

## Shutdown

Press `Ctrl+C` to stop all managed processes and shut down the manager.

## Implementation

- Server: Node.js HTTP + `ws` WebSocket server with Vite middleware mode.
- Client: React SPA served by Vite, dark theme with plain CSS.
- Process supervision: `child_process.spawn` with process-group kill on Unix.
- Log buffer: in-memory ring buffer (2000 lines per process).
