# End-to-End (E2E) Tests

Playwright-based end-to-end tests for the Next.js + Convex starter app.

## How to Run

```bash
# From repo root (runs webapp e2e via turbo)
pnpm e2e

# Or directly from the webapp package
cd apps/webapp && pnpm e2e
```

`pnpm e2e` is also wired into the git **pre-push** hook (alongside `test` and `typecheck`), so admin specs require the Convex env setup below before pushing.

## Prerequisites

- `apps/webapp/.env.local` must exist with a valid `NEXT_PUBLIC_CONVEX_URL`
- The Convex dev deployment must be reachable from the dev server
- Playwright browsers installed (`npx playwright install` if needed)
- **For admin specs:** `E2E_SEEDING_ENABLED` must be set on the Convex deployment (see [E2E Admin Seeding](#e2e-admin-seeding) below)

### Port configuration

`pnpm run setup` assigns a random `PORT` (49152–65535, IANA ephemeral range) to `apps/webapp/.env.local` on first run if not already set.
E2e tests resolve port in order: `process.env.PORT` (if set) → `.env.local` `PORT` → `3000`.
Do not assume `localhost:3000`.

## Folder Structure

```
tests/e2e/
  README.md
  playwright.config.ts
  tsconfig.json
  fixtures/
    auth.fixture.ts        # authenticatedPage fixture (anonymous login)
    admin.fixture.ts       # systemAdminPage fixture (anonymous login + promote + verify)
  support/
    tags.ts                # TAG_UPSTREAM / TAG_DOWNSTREAM / TAG_AUTH / TAG_NAV / TAG_ADMIN
    upstream-flows.ts      # registry of upstream-owned routes (regression baseline)
    env.ts                 # shared .env.local reader
    convex-client.ts       # ConvexHttpClient wrapper (promoteSessionToSystemAdmin)
    seed-guard.ts          # fail-fast guard when E2E_SEEDING_ENABLED is missing
  pages/
    base.page.ts           # shared BasePage (do not modify)
    home.page.ts           # public landing page
    login.page.ts          # /login
    app-dashboard.page.ts  # /app
    profile.page.ts        # /app/profile
    admin-dashboard.page.ts      # /app/admin
    admin-users.page.ts          # /app/admin/users
    admin-google-auth.page.ts    # /app/admin/google-auth
  specs/
    upstream/              # template-owned flows (tagged @upstream)
    downstream/            # fork-specific flows (tagged @downstream)
```

## Upstream vs Downstream Ownership

- **Upstream** specs (`specs/upstream/`) cover flows owned by the `next-convex-starter-app` template. They mirror the intent of the git `upstream` remote and the `check-upstream-modifications` script: downstream forks should not modify them unless contributing back.
- **Downstream** specs (`specs/downstream/`) are for fork-specific flows. See `specs/downstream/README.md` for conventions.

## Tagging & Filtering

Specs are tagged with Playwright native tags on `test.describe`:

```typescript
test.describe('Home Page', { tag: [TAG_UPSTREAM, TAG_NAV] }, () => {
  // ...
});
```

Filter with `--grep`:

```bash
cd apps/webapp && pnpm exec playwright test --config=tests/e2e/playwright.config.ts --grep @upstream
cd apps/webapp && pnpm exec playwright test --config=tests/e2e/playwright.config.ts --grep @downstream
cd apps/webapp && pnpm exec playwright test --config=tests/e2e/playwright.config.ts --grep @admin
```

## `support/upstream-flows.ts` Registry

`UPSTREAM_FLOWS` is the canonical registry of upstream-owned routes. These specs form the **regression baseline for the base UI migration** — they must stay green during UI changes.

## Page Object Pattern

- Extend `BasePage`.
- **All page objects must wait for specific UI signals (visible headings/content), not `networkidle`.** Convex keeps the WebSocket connection active, so `waitForLoad()`/`networkidle` never settles on pages backed by Convex. Override `navigate()` and wait for the content that proves the page actually rendered.
- Be careful with signals that appear during skeleton/loading states (e.g. the admin google-auth `h1` renders during loading too). Wait for a **loaded-only** signal (e.g. `Google Authentication Control` card title, or a real user-list row rather than a skeleton).
- `BasePage.waitForLoad()` (networkidle) still exists on the base class but should not be used — it is deprecated for this suite.

## E2E Admin Seeding

Admin specs promote the anonymous test user to `system_admin` via a dev-only, env-gated Convex mutation (`services/backend/convex/e2e.ts`). The gate is the deployment env var `E2E_SEEDING_ENABLED`.

**Mandatory one-time setup** on the deployment matching `NEXT_PUBLIC_CONVEX_URL` in `apps/webapp/.env.local`:

```bash
cd services/backend && npx convex env set E2E_SEEDING_ENABLED true
```

- **Never set `E2E_SEEDING_ENABLED` on production deployments** — local/dev only.
- The mutation is safe by default: when the env var is missing it throws `FORBIDDEN`.
- If the env var is missing, the `systemAdminPage` fixture fails fast with actionable setup instructions (`support/seed-guard.ts`).

## Auth & Admin Fixtures

`fixtures/auth.fixture.ts` uses `test.extend` to provide `authenticatedPage`, which performs an anonymous login before each test:

```typescript
import { test } from '../../fixtures/auth.fixture';

test('shows dashboard when authenticated', async ({ authenticatedPage }) => {
  // authenticatedPage is already logged in
});
```

`fixtures/admin.fixture.ts` provides `systemAdminPage` — anonymous login, promotion to `system_admin` (via the seeding mutation), a page reload, and a verification that `/app/admin` shows the `Admin Dashboard` heading before the test body runs:

```typescript
import { test } from '../../fixtures/admin.fixture';

test('shows the admin dashboard', async ({ systemAdminPage }) => {
  // systemAdminPage is authenticated as a system admin
});
```

## Excluded Pages

`/test/*` demo pages are explicitly **excluded** from e2e coverage by policy. Login code (`/login/code`) and account recovery (`/recover`) flows are also excluded for now (phased for later slices).

## Standing Policy

New UI features/changes should add matching e2e tests in the appropriate folder:

- Template flows → `specs/upstream/` (tagged `@upstream`)
- Fork-specific flows → `specs/downstream/` (tagged `@downstream`)

## Troubleshooting

- **Port mismatch / connection refused:** Verify `PORT` in `apps/webapp/.env.local` matches the running dev server. Unset a conflicting shell `PORT` (`unset PORT`). Kill stale `next dev` processes before re-running e2e. Check Playwright startup log: `[e2e] Using port …`.
- **Auth tests fail mysteriously with `reuseExistingServer: true`:** you may have `pnpm dev` running from `apps/webapp` only (Next.js without Convex). Kill it and either let Playwright start the server, or run `pnpm dev` from **repo root**.
- **Cold start:** the turbo dev server may take up to 120s to start both webapp and Convex (the `webServer` timeout is set to 120_000ms).
