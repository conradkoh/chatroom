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
- **services/backend** — Convex backend

---

## Frontend (apps/webapp)

### Dark Mode — Critical for All Components

Use semantic colors that adapt to both light and dark modes:

| Purpose         | Preferred               | Avoid              |
| --------------- | ----------------------- | ------------------ |
| Primary text    | `text-foreground`       | `text-black`       |
| Secondary text  | `text-muted-foreground` | `text-gray-600`    |
| Card background | `bg-card`               | `bg-white`         |
| Hover states    | `hover:bg-accent/50`    | `hover:bg-gray-50` |
| Borders         | `border-border`         | `border-gray-200`  |

**Brand/Status colors must include dark variants:**

```tsx
// Good
bg-red-50 dark:bg-red-950/20
text-red-600 dark:text-red-400

// Bad - single mode only
bg-red-50  // white text on light red in dark mode
```

**Testing**: Verify components in light mode, dark mode, and system mode.

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

### Nx Commands

```bash
# Run a target on specific project
nx run @workspace/webapp:dev
nx run @workspace/backend:typecheck

# Run many targets
nx run-many --target=test --projects=@workspace/webapp,@workspace/backend
```

---

## Project Structure

```
chatroom/
├── apps/webapp/           # Next.js frontend application
├── packages/cli/          # CLI package (chatroom-cli on npm)
├── services/backend/      # Convex backend
├── docs/                  # Documentation
├── guides/                # Guides and tutorials
├── codemaps/              # Code mapping templates
└── scripts/               # Utility scripts
```

---

## 6. CHATROOM INTEGRATION

If you are given a role in the chatroom ecosystem, you MUST always direct your questions to the user via the chatroom handoff command with the user as the target chatroom.

The chatroom get-next-task command is of this format:

```
CHATROOM_CONVEX_URL=<endpoint> \
chatroom get-next-task --chatroom-id=<chatroom-id> --role=<role>
```

The chatroom handoff command is of this format:

```
CHATROOM_CONVEX_URL=<endpoint> \
chatroom handoff --chatroom-id=<id> --role=<role> --next-role=<role>
```

### CRITICAL: Execution Rules for Chatroom Commands

**`get-next-task` MUST be executed immediately via the `bash` tool — not documented, not deferred.**

The correct session loop is:

1. **Immediately run** `get-next-task` via `bash` and block until a task arrives
2. **Process** the task
3. **Run** `handoff` via `bash` to signal completion and pass control
4. **Immediately run** `get-next-task` again to wait for the next task

**Common mistakes to avoid:**

- ❌ Adding `get-next-task` to the todo list and then returning a summary to the user instead of running it
- ❌ Treating `get-next-task` as something to document rather than execute
- ❌ Skipping the `bash` tool call and just describing what you would do

The todo list is for _tracking_, not _executing_. The `bash` tool is what actually runs the command. Both must be used — add the task to the todo list AND call `bash` to execute it.

To ensure that you always get this right, even after compaction, you should always add executing the get-next-task as a todo item, with the full command example and CHATROOM_CONVEX_URL so that you never forget.

### Context Recovery After Compaction

**If you suspect context compaction or summarization has occurred** — for example, if your context window appears to contain only a high-level summary with next steps rather than the full conversation history — re-fetch your system prompt immediately before continuing:

```
CHATROOM_CONVEX_URL=<endpoint> \
chatroom get-system-prompt --chatroom-id=<chatroom-id> --role=<role>
```

This prints your complete role instructions to stdout. Read them carefully, then resume the session loop.

**Signs that compaction has occurred:**

- Your context begins with something like "Summary of prior conversation:" or "Context so far:"
- You are unsure of your role, responsibilities, or which commands to run
- You can see "next steps" but no actual conversation history leading up to them

**Recovery procedure:**

1. Run `get-system-prompt` to reload your full instructions
2. Check your todo list for the last known next step
3. Resume with `get-next-task` or `handoff` as appropriate
