/**
 * Shared helpers for the chatroom-cli npm publish pipeline.
 *
 * ## Why a custom publish pipeline exists
 *
 * `chatroom-cli` depends on `@cursor/sdk`, which pins runtime deps
 * (`@connectrpc/connect-node`, `node:sqlite`). Global installs broke when:
 *
 * 1. **Hoisted SDK copies** — `npm install -g` could resolve a stale `@cursor/sdk`
 *    from a parent `node_modules` instead of the one installed with chatroom-cli.
 * 2. **Missing connect-node** — SDK 1.0.19+ dynamically imports
 *    `@connectrpc/connect-node`; it must be a direct dependency of chatroom-cli.
 *
 * We address (1) with `importBundledCursorSdk()` (scoped `require.resolve` from the
 * chatroom-cli install root) and (2) by exact-pinning `@cursor/sdk` and verifying
 * runtime deps before publish.
 *
 * ## Why not `npm publish` directly from the pnpm workspace?
 *
 * - `npm pack` from a pnpm tree embeds `../../node_modules/.pnpm/...` paths that
 *   cannot be extracted on install.
 * - `devDependencies` use `workspace:*` (plain npm cannot install them).
 *
 * ## Pipeline overview
 *
 * 1. `guard-workspace-publish.ts` — block accidental publish from the workspace
 * 2. `prepare-npm-publish.ts` — stage flat `node_modules`, pack, verify
 * 3. `verify-publish-artifacts.ts` — preflight checks (also run standalone)
 * 4. `npm publish chatroom-cli-<version>.tgz --ignore-scripts` from `.npm-publish/`
 *
 * Build + test run in the monorepo first; staging uses `npm install` only to produce
 * a publishable tree. `prepublishOnly` in the workspace package.json must not run
 * `pnpm build` (workspace protocol deps break plain npm).
 */
import { join } from 'node:path';

/** packages/cli root (parent of scripts/). */
export const cliRoot = join(import.meta.dir, '..');

/** package.json shape used when writing the publish staging manifest. */
export interface PublishPackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  bundledDependencies?: string[];
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
