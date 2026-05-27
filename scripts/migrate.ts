#!/usr/bin/env bun

/**
 * Database Migration Runner
 *
 * Runs all pending Convex database migrations using the @convex-dev/migrations framework.
 * Automatically targets:
 *   - LOCAL development server — when CONVEX_DEPLOY_KEY is not set (default)
 *   - PRODUCTION deployment    — when CONVEX_DEPLOY_KEY is set (e.g. in CI)
 *
 * All migrations are idempotent and track their own progress — safe to run multiple times.
 * If interrupted, they resume from where they left off on the next run.
 *
 * Usage:
 *   pnpm run migrate
 *
 * Environment:
 *   CONVEX_DEPLOY_KEY  — when set, targets production; otherwise targets local dev
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { $ } from 'bun';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../services/backend');

// ─── Environment Detection ───────────────────────────────────────────────────

const isLocal = !process.env.CONVEX_DEPLOY_KEY;

if (isLocal) {
  console.log('🏠 Running migrations against LOCAL development server.');
  console.log('   Make sure `convex dev` is running in another terminal.\n');
} else {
  console.log('☁️  Running migrations against PRODUCTION deployment.\n');
}

// ─── Runner ──────────────────────────────────────────────────────────────────

const convexArgs = isLocal ? [] : ['--prod'];

console.log('🚀 Running all migrations via @convex-dev/migrations...\n');

try {
  const cmd =
    convexArgs.length > 0
      ? $`npx convex run migrations:runAll ${convexArgs[0]}`.cwd(BACKEND_DIR)
      : $`npx convex run migrations:runAll`.cwd(BACKEND_DIR);
  await cmd;
  console.log('\n✅ All migrations completed successfully.\n');
} catch (err) {
  const error = err as { stderr?: Buffer; message?: string };
  const stderr = error.stderr?.toString().trim() ?? error.message ?? String(err);
  console.error(`\n❌ Migration failed:\n   ${stderr}\n`);
  process.exit(1);
}
