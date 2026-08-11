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

## Pre-push suite selection

`.husky/pre-push` **always** runs e2e via `scripts/run-pre-push-e2e.ts` — there is no skip branch.

- Template push destination → `@upstream` suite
- Fork or non-template destination → `@downstream` suite

The destination URL git passes as `$2` is resolved by `scripts/resolve-e2e-suite.ts` using `isTemplateRemote` from `scripts/template-repo.ts`. Tag constants are imported from `apps/webapp/tests/e2e/support/tags.ts`.

If Playwright finds zero matching tests (e.g. a fork with no `@downstream` specs yet), the push **fails** — add at least one downstream spec in `specs/downstream/` before your first push to a fork remote.

`pnpm e2e` runs the full unfiltered suite for manual and CI runs on any checkout.

## Reusability

This suite is designed to be reusable across downstream projects: upstream specs define the template regression baseline, downstream specs hold fork-specific flows, and destination-based suite selection keeps fork pre-push focused on their own tests.

## Full detail

See [apps/webapp/tests/e2e/README.md](../../apps/webapp/tests/e2e/README.md) for prerequisites, admin seeding, page-object patterns, and troubleshooting.
