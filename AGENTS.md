---

description: Development guide for the Next.js + Convex monorepo
globs: "\*\*"
alwaysApply: true

---

# Development Guidelines

A quick reference for working with the Next.js + Convex monorepo.

---

## Architecture

- **apps/webapp** — Next.js frontend application
  - `src/application/` — App-specific frontend code (see [README](apps/webapp/src/application/README.md))
- **services/backend** — Convex backend
  - `application/` — App-specific backend code (see [README](services/backend/application/README.md))
- **docs** — Project documentation
  - `application/` — App-specific documentation (see [README](docs/application/README.md))

---

## Frontend (apps/webapp)

### Theming & Dark Mode

Use semantic, theme-aware colors — never hard-coded light-only values.

See **[docs/application/design/theme.md](docs/application/design/theme.md)** — the source of truth for color tokens, dark-mode variants, and testing guidance.

### UI Components & Icons

- **Components**: ShadCN UI
- **Icons**: @radix-ui/react-icons, lucide-react, react-icons

**Add a new ShadCN component:**

```bash
cd apps/webapp && npx shadcn@latest add <component-name>
```

### Next.js App Router

The `params` prop is a Promise — must await it:

```tsx
export default async function MyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div>{id}</div>;
}
```

### Authentication (Frontend)

Use session-aware hooks from convex-helpers:

```tsx
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';

const data = useSessionQuery(api.my.query);
const mutate = useSessionMutation(api.my.mutation);
```

---

## Backend (services/backend)

### Authentication

All authenticated Convex functions require `SessionIdArg`:

```ts
import { SessionIdArg } from 'convex-helpers/server/sessions';

export const myQuery = query({
  args: { ...SessionIdArg /* other args */ },
  handler: async (ctx, args) => {
    // Authenticated
  },
});
```

### Error Handling

All backend errors must use structured `ConvexError({ code, message, fields? })` with codes registered in `services/backend/config/errorCodes.ts`. Bare-string throws (`throw new ConvexError('msg')`) are forbidden — enforced by a unit test. See `docs/developer/error-handling.md` for the full convention, including the return-union pattern for expected business outcomes.

### Feature Flags

Configured in `services/backend/config/featureFlags.ts`.

When adding flags:

- Use safe defaults (off/false)
- Keep reads centralized and typed
- Plan migration path for removal

---

## Core Principles

### Code Approach

**Size of changes**: For complex work, prefer incremental changes or create new code and migrate. Large migrations need a plan — verify as you go.

**Performance**: Use indexes for large volume lookups or ordered columns. In Convex, computations run in the DB — n+1 queries are often fine.

**Naming**: Function names should match their actions. Mutations: `create`, `write`, `update`. Queries: `get`, `list`, `fetch`. No mutations in "get" methods.

### DAFT Abstraction Principles

- **Dimensionality**: High-dimension problems (UI layer) can't be solved by abstraction alone
- **Atomicity**: One responsibility per abstraction
- **Friction**: Good defaults with few props beat many mandatory props
- **Testing**: Simple functions are easier to test than complex classes

---

## Common Tasks

### Running the Project

```bash
# Start dev server
pnpm dev

# Run initial setup
pnpm setup
```

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch
```

### Type Checking & Linting

```bash
# Type check both apps
pnpm typecheck

# Lint with fixes
pnpm lint:fix

# Format code
pnpm format:fix
```

### Turbo Commands

```bash
# Run a target on specific project
turbo run dev --filter=webapp
turbo run typecheck --filter=backend

# Run many targets
turbo run test --filter=webapp --filter=backend
```

---

## Project Structure

```
chatroom/
├── apps/webapp/           # Next.js frontend application
│   └── src/application/   # App-specific frontend code
├── packages/cli/          # CLI package (chatroom-cli on npm)
├── services/backend/      # Convex backend
│   └── application/       # App-specific backend code
├── docs/                  # Documentation
│   └── application/       # App-specific documentation
├── guides/                # Guides and tutorials
└── scripts/               # Utility scripts
```

---

<chatroom>
## CHATROOM INTEGRATION

### Workflow Loop

**Level A (session)** = the outer loop. **Level B (chatroom task)** = one iteration.

```
get-next-task → do work → handoff → get-next-task → repeat
```

1. **Run `get-next-task`** immediately via `bash` — a blocking tool call that resolves when the user or team message is ready, delivered as a chatroom task; infer what to do from that message (numbered next-steps in delivery are hints, not a rigid script)
2. **Process** the task
3. **Run `handoff`** to signal completion
4. **Run `get-next-task`** again to wait for the next message

### Session Model (Level A vs Level B)

A session (Level A) processes many chatroom tasks (Level B). Completing one chatroom task does NOT end the session.

**Explicit rule:** After EVERY handoff — even to `user` — you MUST run `get-next-task` in the foreground to continue the session. The workflow loop above never ends: each handoff completes Level B, and `get-next-task` keeps Level A alive.

### Reliability

Always add these as the **last two todo items** for every task:

1. **Handoff item** — contains the full handoff command (see Command Reference)
2. **Get-next-task item** — contains the full get-next-task command (see Command Reference)

This ensures you never forget to pass control back — just copy the command from the todo item and run it via `bash`.

### Command Reference

| Action                                   | Command                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Fetch next task                          | `CHATROOM_CONVEX_URL=<endpoint> chatroom get-next-task --chatroom-id=<id> --role=<role>`              |
| Pass control                             | `CHATROOM_CONVEX_URL=<endpoint> chatroom handoff --chatroom-id=<id> --role=<role> --next-role=<role>` |
| Refresh system prompt (after compaction) | `CHATROOM_CONVEX_URL=<endpoint> chatroom get-system-prompt --chatroom-id=<id> --role=<role>`          |

### Context Recovery

If you suspect compaction (context starts with "Summary of:", or you're unsure of your role):

1. Run `get-system-prompt` to reload full instructions
2. Check todo list for last known step
3. Resume with `get-next-task` or `handoff`
   </chatroom>
