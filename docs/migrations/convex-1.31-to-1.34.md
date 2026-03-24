# Convex Upgrade: v1.31.2 → v1.34.0

## Overview

This document covers the upgrade of Convex packages from v1.31.2 to v1.34.0.

| Package                  | Previous | New               |
| ------------------------ | -------- | ----------------- |
| `convex`                 | 1.31.2   | 1.34.0            |
| `convex-helpers`         | 0.1.108  | 0.1.114           |
| `convex-test`            | 0.0.41   | 0.0.43            |
| `@convex-dev/migrations` | 0.3.1    | 0.3.1 (unchanged) |

## Breaking Changes

### Node.js 18 Support Dropped (v1.31.5)

Convex v1.31.5+ no longer supports Node.js 18. Ensure you are running **Node.js 20 or newer**.

```bash
node --version  # Must be >= v20.0.0
```

### `db.get`, `db.patch`, `db.replace`, `db.delete` API Change (v1.31.0)

Since v1.31.0, these methods accept a table name as the first argument:

```ts
// New syntax (recommended)
const message = await db.get('messages', messageId);
await db.patch('messages', messageId, { text: 'updated' });
await db.delete('messages', messageId);

// Old syntax (still works, but not recommended)
const message = await db.get(messageId);
await db.patch(messageId, { text: 'updated' });
await db.delete(messageId);
```

**Action required:** Consider migrating to the new syntax. You can use:

- ESLint rule: `@convex-dev/explicit-table-ids`
- Codemod: `npx @convex-dev/codemod@latest explicit-ids`

> **Note:** Our codebase currently uses the old syntax. This is a non-breaking change — the old syntax continues to work. Migration to the new syntax can be done incrementally in a future PR.

## Notable New Features

### CLI Enhancements

- **AI context files** (v1.34.0): `npx convex ai-files` manages AI context files (AGENTS.md, CLAUDE.md) for your project
- **Deployment management** (v1.34.0): `npx convex deployment create/select` for managing cloud deployments
- **`--deployment` flag** (v1.34.0): Target specific deployments by name, ref, or shorthand (`dev`/`prod`)
- **Insights CLI** (v1.32.0): `npx convex insights` to view deployment insights
- **`npx convex init`** (v1.33.0): Non-pushing initialization command, useful for `predev` scripts
- **Environment variable management** (v1.33.0): `npx convex env set` now supports interactive input, `--from-file`, and bulk setting

### Pagination Options (v1.32.0)

New `maximumRowsRead` and `maximumBytesRead` options in `PaginationOptions` for fine-grained control over pagination reads.

### Local Development (v1.32.0)

Local backend data is now stored in `.convex/` directory in the project root (instead of `~/.convex`), enabling isolated storage per worktree.

### TypeScript Native Preview Support (v1.31.1)

Speed up type checking with `npx convex dev` by using the TypeScript native preview. Add `@typescript/native-preview` as a dev dependency and set `typescriptCompiler: "tsgo"` in `convex.json`.

## Bug Fixes

- Fixed websocket disconnects when using Bun (v1.32.0)
- Improved websocket backoff behavior (v1.34.0)
- Fixed React Native `window.addEventListener is not a function` (v1.31.4)
- Fixed `db` API type issue allowing broader ID types (v1.31.2)
- Optimized code push to only upload changed modules (v1.31.7)

## Migration Steps

1. ✅ Updated `convex` to ^1.34.0 in both `services/backend` and `apps/webapp`
2. ✅ Updated `convex-helpers` to ^0.1.114 in both packages
3. ✅ Updated `convex-test` to ^0.0.43 in `services/backend`
4. ✅ Verified `pnpm typecheck` passes
5. ✅ Verified `pnpm test` passes (all 9 tests)

## Future Considerations

- **Explicit table IDs**: Consider running `npx @convex-dev/codemod@latest explicit-ids` to adopt the new `db.get("table", id)` syntax
- **TypeScript native preview**: Consider enabling `tsgo` compiler for faster type checking during development
- **AI files**: Run `npx convex ai-files install` to set up AI context files if using AI-assisted development
