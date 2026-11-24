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

### Memory (OKF)

Agent memory is stored as an [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle in **`memory/`**.

- **Bundle root:** [memory/index.md](memory/index.md)
- **Taxonomy (folders &amp; document types):** [memory/architecture/okf-document-taxonomy.md](memory/architecture/okf-document-taxonomy.md)
- **What is OKF?:** [memory/development/what-is-okf.md](memory/development/what-is-okf.md)

Allowed folders: `architecture`, `product`, `testing`, `development`.  
Allowed document types (`type` frontmatter): `decision-log`, `best-practice`, `guide`, `tech-debt`.

---

## Frontend (apps/webapp)

### Theming & Dark Mode

Use semantic, theme-aware colors — never hard-coded light-only values.

See **[docs/application/design/theme.md](docs/application/design/theme.md)** — the source of truth for color tokens, dark-mode variants, and testing guidance.

### UI Components & Icons

- **Components**: ShadCN UI with **Base UI** backend (`base-vega` style in `apps/webapp/components.json`)
- **Primitives**: `@base-ui/react` (not Radix UI)
- **Icons**: lucide-react, react-icons
- **Feedback**: no toasts, snackbars, or popups; see [docs/application/design/theme.md](docs/application/design/theme.md) (Components → Feedback & Notifications)

**Add a new ShadCN component:**

```bash
cd apps/webapp && npx shadcn@latest add <component-name>
```

**Migrating from Radix-based shadcn (downstream forks):**

See **[docs/developer/shadcn-base-ui-migration.md](docs/developer/shadcn-base-ui-migration.md)** — strategy, API changes (`asChild` removal, data-attribute selectors), and a playbook for older apps.

### Next.js App Router

The `params` prop is a Promise — must await it:

```tsx
export default async function MyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div>{id}</div>;
}
```

### Reactive local state (Legend State)

For **real-time local stores** and coordination that would otherwise use `useEffect` to sync Convex data into `useState`, use [Legend State signals](docs/developer/legend-state-signals.md) (`observable` / `computed` / `useObserve`) — keep Convex as server SSOT and `useEffect` for DOM/timers only.

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

### Builtin Agent Roles

Builtin role lifecycle and team membership belong in shared role metadata; prompts and handoff contracts are exhaustive capabilities. Verify a role on the actual chatroom sidebar before claiming it is visible. Follow [the builtin agent-role guide](docs/conventions/agent-role-contracts.md) when adding or changing a role.

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
# Start dev: pushes Convex code, runs pending migrations, starts the watcher and the webapp
pnpm dev

# Run initial setup
pnpm setup
```

`pnpm dev` starts the backend dev wrapper (`services/backend` → `scripts/start-convex-dev.ts`) alongside the webapp. The wrapper resolves the development deployment from the process environment first, then `services/backend/.env.local`, and then:

1. **Refuses to start** when `CONVEX_DEPLOYMENT` selects a `prod:` deployment (dev never runs against production), or when `CONVEX_DEPLOY_KEY` is set in the process environment or in `services/backend/.env.local`. It prints the reason, exits non-zero, and starts nothing.
2. Runs `convex dev --once` to push the code. If the push fails, it skips migrations with a warning and still starts the watcher.
3. Starts the `convex dev` watcher.
4. Runs pending migrations against that same deployment in the background, once the deployment accepts `convex run` (bounded wait of 120 seconds). It prints the migration plan and the result. A failed migration prints a warning naming the migration and the target; the watcher keeps running. For a local deployment the wait probes the target URL (`CONVEX_URL`), or else `ports.cloud` in `services/backend/.convex/local/default/config.json`; if neither is known, migrations are skipped with a warning and nothing is run.

These cases skip migrations and still start the watcher:

- **Unconfigured** (no development deployment yet): `convex dev` runs its normal setup, and migrations are skipped with a message.
- **`SKIP_DEV_MIGRATIONS=1`**: migrations are skipped for that run only.

### Version Updates

**All workspace packages share one version.** There is no bump script — edit the
`version` field in every tracked manifest together.

The set is defined by `pnpm-workspace.yaml` (`apps/*`, `services/*`, `packages/*`)
plus the root manifest. Currently that is six files, and it is exactly what
`git ls-files '*package.json'` returns:

```
package.json                   # root — chatroom
apps/local/package.json        # @workspace/local
apps/webapp/package.json       # @workspace/webapp
packages/cli/package.json      # chatroom-cli (published to npm)
packages/shared/package.json   # @workspace/shared
services/backend/package.json  # @workspace/backend
```

Do **not** bump, and do not add a `version` to:

- `.opencode/package.json` — untracked, no `version` field
- `packages/cli/.npm-publish/package.json` — gitignored build artifact, rewritten by
  `packages/cli/scripts/prepare-npm-publish.ts`

Nothing else needs updating: `pnpm-lock.yaml` does not record workspace versions,
and the CLI reads its version at runtime from `packages/cli/package.json`
(`packages/cli/src/version.ts`), so there is no version constant to keep in sync.

Verify before committing — this must print exactly **one** line:

```bash
# All six manifests in sync?
git ls-files '*package.json' | xargs grep -h '^  "version":' | sort -u
```

Bumping only a subset (for example just the npm publish set: root, `packages/cli`,
`packages/shared`) strands the remaining packages and needs a repair bump later.
A new workspace package under `apps/`, `services/`, or `packages/` must adopt the
same version.

**CLI publishing:** `chatroom-cli` is published to npm only by `.github/workflows/publish-cli.yml`, which runs on every push to `master` and publishes when the `packages/cli/package.json` version is newer than npm's (it packs and publishes the tarball from `packages/cli/.npm-publish`) — never run `npm publish` from `packages/cli`.

### Daemon Debugging

```bash
chatroom logs --chatroom-id <id> --since 1h
chatroom debug --chatroom-id <id>
```

### Database migrations

`pnpm dev` runs pending Convex data migrations for you, against the development deployment it uses (see [Running the Project](#running-the-project)). After pulling schema changes, start `pnpm dev` and let it run them.

Use `pnpm migrate` as a manual one-off runner: to re-run migrations after a failure reported by `pnpm dev`, or to run them without restarting the dev server. For a local deployment, run it while `pnpm dev` is already running.

```bash
# From repo root — targets the same deployment `convex dev` uses
pnpm migrate
```

- Uses `scripts/migrate-lib.ts` → `migrations:runAll`.
- Targets the development deployment in `services/backend/.env.local` (local or hosted) when `CONVEX_DEPLOY_KEY` is unset. Targets production (`--prod`) when `CONVEX_DEPLOY_KEY` is set in the process environment (CI only). Refuses to run when `CONVEX_DEPLOY_KEY` is set only in `services/backend/.env.local`. The first printed line, `🎯 Migration target: …`, shows which one ran.
- Exits non-zero when a migration fails.
- Idempotent — safe to re-run.

**Writing a migration:**

- A purge migration (`migrations.define({ table })` that deletes rows) is valid only while its table is still in `services/backend/convex/schema.ts`. A table missing from the schema makes the backend reject the migration's paginated read (`Index <table>.by_creation_time not found`), which stops `runAll` and blocks every later migration.
- When you drop a table from the schema, remove its purge migration and its `allMigrationReferences` entry in `services/backend/convex/migrations.ts` in the same change. Do not replace it with a no-op.
- Dropping a table does not delete its rows. Leftover rows in a dropped table can only be cleared from the deployment dashboard, because no migration can read that table.
- Name the table with a single-quoted string literal and do not cast it (`as never` or otherwise). `services/backend/convex/migrations.schemaTables.spec.ts` fails when a migration names a table missing from the schema, uses a non-literal `table` value, or casts one.

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch
```

For Playwright commands, upstream/downstream spec ownership, and pre-push suite selection by push destination, see [E2E testing conventions](docs/developer/e2e-testing.md).

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
next-convex-starter-app/
├── apps/webapp/           # Next.js frontend
│   └── src/application/   # App-specific frontend code
├── services/backend/      # Convex backend
│   └── application/       # App-specific backend code
├── docs/                  # Documentation
│   └── application/       # App-specific documentation
├── memory/                # OKF agent memory bundle
│   ├── architecture/
│   ├── product/
│   ├── testing/
│   └── development/
└── scripts/               # Utility scripts
```
