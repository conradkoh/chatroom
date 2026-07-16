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
 *   pnpm migrate
 *
 * Run while `convex dev` is already running — no dev server restart required.
 * Agents: use this one-off command after schema changes that include backfill migrations.
 *
 * Environment:
 *   CONVEX_DEPLOY_KEY  — when set, targets production; otherwise targets local dev
 */

import { isLocalMigrationTarget, runMigrations } from './migrate-lib';

const isLocal = isLocalMigrationTarget();

if (isLocal) {
  console.log('🏠 Running migrations against LOCAL development server.');
  console.log('   Requires `convex dev` to be running (no restart needed).\n');
} else {
  console.log('☁️  Running migrations against PRODUCTION deployment.\n');
}

console.log('🚀 Running all migrations via @convex-dev/migrations...\n');

try {
  await runMigrations();
  console.log('\n✅ All migrations completed successfully.\n');
} catch (err) {
  const error = err as { stderr?: Buffer; message?: string };
  const stderr = error.stderr?.toString().trim() ?? error.message ?? String(err);
  console.error(`\n❌ Migration failed:\n   ${stderr}\n`);
  process.exit(1);
}
