# E2E Testing

Playwright end-to-end tests for the Next.js + Convex starter app.

## Location & commands

Suite root: `apps/webapp/tests/e2e/`

```bash
# From repo root (full unfiltered suite)
pnpm e2e

# Single spec
cd apps/webapp && pnpm exec playwright test --config=tests/e2e/playwright.config.ts specs/upstream/markdown-editor.spec.ts

# Tagged subsets (same filters pre-push uses)
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

`.husky/pre-push` runs e2e only when a pushed ref targets `master`, which protects direct pushes to `master` before they leave the machine. Pushes to other branches skip the local E2E run because their pull requests are tested by GitHub Actions.

- Template push destination → `@upstream` suite
- Fork or non-template destination → `@downstream` suite

The destination URL git passes as `$2` is resolved by `scripts/resolve-e2e-suite.ts` using `isTemplateRemote` from `scripts/template-repo.ts`. Tag constants are imported from `apps/webapp/tests/e2e/support/tags.ts`.

Pull requests targeting `master` use `github.repository` in `.github/workflows/e2e.yml` to select the same ownership boundary: the template repository runs `@upstream`, while forks and downstream repositories run `@downstream`. CI starts the open-source Convex backend in an ephemeral Docker container, deploys this repository's backend functions to it, and enables E2E seeding there. No hosted Convex URL or repository secret is required.

If Playwright finds zero matching tests (e.g. a fork with no `@downstream` specs yet), the direct `master` push **fails** — add at least one downstream spec in `specs/downstream/` before pushing to a fork remote.

`pnpm e2e` remains the explicit full, unfiltered suite for manual compatibility checks on any checkout.

## Reusability

This suite is designed to be reusable across downstream projects: upstream specs define the template regression baseline, downstream specs hold fork-specific flows, and repository-aware suite selection keeps local pre-push and pull-request CI focused on the owning repository's tests.

## Full detail

See [apps/webapp/tests/e2e/README.md](../../apps/webapp/tests/e2e/README.md) for prerequisites, admin seeding, page-object patterns, and troubleshooting.
