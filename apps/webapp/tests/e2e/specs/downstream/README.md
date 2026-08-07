# Downstream E2E Tests

Add fork-specific UI tests here. Do **not** modify `specs/upstream/` unless contributing back to the template.

## Conventions

1. Create specs in this folder with Playwright native tag `TAG_DOWNSTREAM` from `support/tags.ts`.
2. Extend page objects from `pages/` or add fork-specific page objects in `pages/downstream/`.
3. Reference `support/upstream-flows.ts` to see which routes are owned by the upstream template.
4. When you modify an upstream-owned page route, update the corresponding upstream spec via a PR to the template — or override in your fork's downstream spec with a comment explaining the divergence.

## Filtering

```bash
# Run only downstream tests
cd apps/webapp && pnpm exec playwright test --config=tests/e2e/playwright.config.ts --grep @downstream

# Run only upstream (template) tests
cd apps/webapp && pnpm exec playwright test --config=tests/e2e/playwright.config.ts --grep @upstream
```
