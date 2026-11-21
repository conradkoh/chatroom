#!/usr/bin/env bun

/**
 * Database Migration Runner
 *
 * Runs all pending Convex database migrations using the @convex-dev/migrations framework.
 * Automatically targets:
 *   - PRODUCTION deployment    — when CONVEX_DEPLOY_KEY is set (e.g. in CI)
 *   - DEVELOPMENT deployment   — otherwise: the one `convex dev` uses, read from
 *                                services/backend/.env.local (local or hosted).
 *                                The target is printed before anything runs.
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
 *   CONVEX_DEPLOY_KEY  — when set, targets production; otherwise targets the development
 *                        deployment from services/backend/.env.local
 */

import { describeConvexTarget, unrunnableReason } from './convex-target';
import { describeMigrationError, resolveMigrationTarget, runMigrations } from './migrate-lib';

const target = await resolveMigrationTarget();

console.log(`🎯 Migration target: ${describeConvexTarget(target)}`);

const blockedReason = unrunnableReason(target);
if (blockedReason) {
  console.error(`\n❌ ${blockedReason}\n`);
  process.exit(1);
}

if (target.kind === 'local') {
  console.log('   Requires `convex dev` to be running (no restart needed).');
}
console.log('');

console.log('🔎 Checking migration plan...\n');

try {
  await runMigrations(target);
  console.log('\n✅ All migrations completed successfully.\n');
} catch (err) {
  console.error(`\n❌ Migration failed:\n   ${describeMigrationError(err)}\n`);
  process.exit(1);
}
