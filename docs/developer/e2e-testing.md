# E2E Testing

Playwright end-to-end tests for the Next.js + Convex starter app.

## Location & commands

Suite root: `apps/webapp/tests/e2e/`

```bash
# From repo root (full unfiltered suite)
pnpm e2e

# Single spec
cd apps/webapp && pnpm exec playwright test --config=tests/e2e/playwright.config.ts specs/upstream/markdown-editor.spec.ts

# Repository-aware tagged subsets
cd apps/webapp && pnpm e2e:upstream
cd apps/webapp && pnpm e2e:downstream
```

## Folder conventions

| Path                | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `specs/upstream/`   | Template-owned flows (`@upstream`)        |
| `specs/downstream/` | Fork-specific flows (`@downstream`)       |
| `pages/`            | Page objects — extend `BasePage`          |
| `support/`          | Tags, env helpers, upstream flow registry |

Filter by tag: `--grep @upstream`, `--grep @markdown`, etc.

## When E2E runs

E2E is owned by CI, not the local pre-push hook. `.husky/pre-push` runs only `pnpm run typecheck`; no test or E2E command executes locally on push. Direct pushes to `master` no longer run a local E2E gate.

Repository-aware suite selection keeps CI focused on the owning repository's tests:

- Template repository pull requests → `@upstream` suite
- Fork or non-template destination → `@downstream` suite

Pull requests targeting `master` use `github.repository` in `.github/workflows/e2e.yml` to select the same ownership boundary: the template repository runs `@upstream`, while forks and downstream repositories run `@downstream`. Tag constants are imported from `apps/webapp/tests/e2e/support/tags.ts`, and `scripts/resolve-e2e-suite.ts` (using `isTemplateRemote` from `scripts/template-repo.ts`) resolves the suite for the CI workflow. CI starts the open-source Convex backend in an ephemeral Docker container, deploys this repository's backend functions to it, and enables E2E seeding there. No hosted Convex URL or repository secret is required.

Pull requests targeting `master` use `github.repository` in `.github/workflows/e2e.yml` to select the same ownership boundary: the template repository runs `@upstream`, while forks and downstream repositories run `@downstream`. CI starts the open-source Convex backend in an ephemeral Docker container, deploys this repository's backend functions to it, and enables E2E seeding there. No hosted Convex URL or repository secret is required.

## Builtin agent sidebar regression

`specs/downstream/agent-sidebar.spec.ts` exercises the authenticated chatroom route for separate Duo and Solo rooms. It reads each room's real team structure and status APIs, then checks every declared role appears once under its expected sidebar group with an offline label and no saved workspace configuration, machine, or launch request. It also reloads the room and rechecks its persisted assignment. Readiness waits target the Welcome heading, Setup Workspace dialog, and actual role rows; the test does not wait for `networkidle`.

Run the focused Chromium cases with:

```bash
pnpm --dir apps/webapp exec playwright test --config=tests/e2e/playwright.config.ts specs/downstream/agent-sidebar.spec.ts --project=chromium
```

The E2E workflow runs every downstream spec for pull requests targeting `master` in a disposable self-hosted Convex deployment, so this spec is discovered by the existing `e2e:downstream` step.

For a local run, the backend reached by `getConvexUrl()` must match `NEXT_PUBLIC_CONVEX_URL` used by the webapp. Anonymous signup must be allowed by that local backend. If signup is disabled, set `E2E_SEEDING_ENABLED` only on a disposable test deployment; never enable it on production. The focused sidebar test itself does not need seeding because it uses anonymous authentication and creates its own room. Keep the browser and backend isolated from an existing development session when using the disposable Docker recipe in [the E2E workflow](../../.github/workflows/e2e.yml).

If Playwright finds zero matching tests for a selected suite (e.g. a fork with no `@downstream` specs yet), the CI run is an intentional skip rather than a failure — add at least one downstream spec in `specs/downstream/` when a fork's flows need coverage. The workflow implementation for this skip behavior lands in a subsequent slice.

`pnpm e2e` remains the explicit full, unfiltered suite for manual compatibility checks on any checkout.

## Reusability

This suite is designed to be reusable across downstream projects: upstream specs define the template regression baseline, downstream specs hold fork-specific flows, and repository-aware suite selection keeps pull-request CI focused on the owning repository's tests.

## Full detail

See [apps/webapp/tests/e2e/README.md](../../apps/webapp/tests/e2e/README.md) for prerequisites, admin seeding, page-object patterns, and troubleshooting.
