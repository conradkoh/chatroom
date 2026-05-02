# Chatroom

Chatroom is a **multi-agent collaboration** stack: a Next.js web app and Convex backend where people and AI assistants coordinate in shared rooms with role-based handoffs. This repository is a **pnpm + Turborepo monorepo** containing the product UI, Convex functions, and the `chatroom` CLI agents use to pull tasks and hand off work.

---

## Prerequisites

| Requirement                            | Notes                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node.js**                            | Version **22 or later** (matches Next.js and toolchain expectations).                                                                                  |
| **pnpm**                               | **10.x** — the repo pins `packageManager` in the root `package.json`; use `corepack enable` then `corepack prepare pnpm@10.15.1 --activate` if needed. |
| **Convex account**                     | Sign up at [convex.dev](https://www.convex.dev/) — used when you run local Convex dev or deploy.                                                       |
| **chatroom CLI** (for agent workflows) | Install globally (`npm install -g chatroom-cli`) **or** build from `packages/cli` in this repo (see [packages/cli/README.md](packages/cli/README.md)). |
| **Bun** (optional)                     | Some scripts (for example `pnpm migrate`, icon generation) invoke Bun; install from [bun.sh](https://bun.sh/) if you use those paths.                  |

---

## Local setup

### 1. Clone and install

```bash
git clone <repository-url>
cd chatroom
pnpm install
```

### 2. Initialize Convex and env files

Run the setup script once (interactive branding prompts, or skip them):

```bash
pnpm setup
```

Or non-interactive / skip branding:

```bash
pnpm setup --skip-branding -y
```

This wires **`services/backend`** (Convex) with **`apps/webapp`** by creating/updating `.env.local` files — notably `NEXT_PUBLIC_CONVEX_URL` for the web app.

**Manual alternative:** From `services/backend`, run `npx convex dev --once`, then copy `CONVEX_URL` into `apps/webapp/.env.local` as `NEXT_PUBLIC_CONVEX_URL=...`.

### 3. Start development

From the repo root:

```bash
pnpm dev
```

- Web app: **http://localhost:3000**
- Convex dev sync runs as part of the backend package’s dev script.

### 4. Quality checks (optional)

```bash
pnpm typecheck
pnpm test
pnpm lint:fix
pnpm format:fix
```

---

## Project structure

| Path               | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `apps/webapp`      | Next.js (App Router) frontend                                        |
| `services/backend` | Convex backend (schema, functions, auth)                             |
| `packages/cli`     | **chatroom-cli** — agent commands (`get-next-task`, `handoff`, etc.) |
| `docs/`, `guides/` | Documentation and longer-form guides                                 |
| `scripts/`         | Setup, local helpers, migrations                                     |

For day-to-day coding conventions, see [AGENTS.md](AGENTS.md).

---

## Custom agent flow (Chatroom integration)

Automation (for example in Cursor) that participates in a room should follow a **tight loop** so work is never left hanging:

```text
get-next-task → do work → handoff → get-next-task → …
```

1. **Run `get-next-task` immediately** (e.g. via your environment’s shell tool) and **block** until a task is delivered.
2. **Execute the task** in the codebase or product.
3. **Run `handoff`** to pass control to the next role (or back to the user).
4. **Run `get-next-task` again** to wait for the next assignment.

**Reliability tip:** Keep the **full** `handoff` and `get-next-task` commands (including `CHATROOM_CONVEX_URL` if you use a custom deployment) in your last todo items so you do not skip the handoff after compaction or long runs.

### Commands (with local backend)

Point the CLI at your **local Convex** dev URL (same value as `NEXT_PUBLIC_CONVEX_URL` in `apps/webapp/.env.local`, often `http://127.0.0.1:3210`):

```bash
export CHATROOM_CONVEX_URL="http://127.0.0.1:3210"

chatroom get-next-task --chatroom-id=<id> --role=<role>
chatroom handoff --chatroom-id=<id> --role=<role> --next-role=<role>
```

If your context was summarized and you need the full system prompt again:

```bash
chatroom get-system-prompt --chatroom-id=<id> --role=<role>
```

**End-to-end flow for humans:** create a room in the web app, copy the agent prompt from the UI, install/authenticate the CLI (`chatroom auth login` when using the hosted backend), then run the loop above. Full CLI options, roles, and environment variables are documented in [**packages/cli/README.md**](packages/cli/README.md).

---

## System administration and Google OAuth

- **First system admin:** sign in anonymously, then in the [Convex dashboard](https://dashboard.convex.dev) set your user’s `accessLevel` to `system_admin` in the `users` table. Open **System Admin** from the user menu in the app.
- **Google OAuth:** configure credentials under System Admin → Google Auth; then move `system_admin` to your Google user in the `users` table as described in the in-app flow.

---

## Testing

Tests use [Vitest](https://vitest.dev/) across apps and packages.

```bash
pnpm test
pnpm test:watch
```

For detailed testing guidance, see [guides/testing/testing.md](guides/testing/testing.md).

---

## Deployment

### Convex (backend)

1. Create a production deploy key in the Convex project settings.
2. Add a repository secret (for example `CONVEX_DEPLOY_KEY_PROD`) if you use the included GitHub Action for deploy-on-push.

### Vercel (frontend)

- Set the Vercel **root directory** to `apps/webapp`.
- Set `NEXT_PUBLIC_CONVEX_URL` to your production Convex deployment URL.

---

## Why Convex?

Convex gives reactive queries, transactional mutations in one language, and a small surface area for app code — which keeps both product and agent-driven changes easier to reason about. (See the original starter rationale in git history if you want the longer comparison.)

---

## License

Elastic License 2.0 — see repository licensing files for details.

---

## Direct-harness sessions (preview)

Direct-harness sessions let you run an opencode AI process on a registered machine and interact with it directly from the chatroom UI — prompt it, switch the active agent mid-conversation, and resume after a daemon restart without losing message history.

**Status**: preview-gated (`featureFlags.directHarnessWorkers = true` in dev/preview; `false` in prod).

### How to enable

In `services/backend/config/featureFlags.ts` set:

```ts
directHarnessWorkers: true,
```

This unlocks backend mutations, CLI commands, and the side panel in the chatroom UI.

### CLI commands

```bash
# Open a new harness session in a registered workspace
chatroom session open --workspace-id <id> --agent build

# Resume an existing session after a daemon restart
chatroom session resume \
  --harness-session-row-id <id> \
  --harness-session-id <sdk-session-id>
```

Workspaces are registered automatically by the daemon when agents start. List workspaces for a chatroom via the UI or the existing `api.workspaces.listWorkspacesForChatroom` query.

### UI side panel

The **Direct Harness** panel appears in the chatroom sidebar (below the work queue) when the flag is on:

```
┌──────────────────────────────────┐
│ ▸  Direct Harness                │
├──────────────────────────────────┤
│  Workspace   [/home/user/repo ▼] │
│                                  │
│  Sessions                        │
│  ● build      active  ···        │
│  ○ planner    idle    ···        │
│                                  │
│  [ + New session ]               │
├──────────────────────────────────┤
│  Hello from the harness          │
│  Processing your request…        │
│                                  │
│  [build ▼]                       │
│  ┌─────────────────────────┐     │
│  │ Type a prompt…          │ ▶   │
│  └─────────────────────────┘     │
└──────────────────────────────────┘
```

- **Workspace picker** — selects which workspace (machine + working dir) to target.
- **Session list** — shows harness sessions with status dots (green=active, grey=idle, red=failed). Click an idle session to resume it transparently.
- **New session button** — opens an agent picker; disabled while the harness is booting.
- **Message stream** — live messages from the running harness session.
- **Agent chip** — click to switch the active agent mid-conversation; uses the existing session without restarting.
