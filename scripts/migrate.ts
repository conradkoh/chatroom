#!/usr/bin/env bun

/**
 * Database Migration Runner
 *
 * Runs all pending Convex database migrations against the production deployment.
 * Requires the CONVEX_DEPLOY_KEY environment variable to be set.
 *
 * All migrations are idempotent — safe to run multiple times.
 *
 * Usage:
 *   pnpm run migrate
 *
 * Or directly:
 *   bun scripts/migrate.ts
 *
 * Environment:
 *   CONVEX_DEPLOY_KEY  — Convex deploy key for the target environment (required)
 */

import { $ } from 'bun';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../services/backend');

// ─── Validation ──────────────────────────────────────────────────────────────

if (!process.env.CONVEX_DEPLOY_KEY) {
  console.error('❌ CONVEX_DEPLOY_KEY environment variable is not set.');
  console.error('   Set it to your Convex deploy key before running migrations.');
  process.exit(1);
}

// ─── Migration Registry ───────────────────────────────────────────────────────

interface Migration {
  /** Convex function path (as passed to `convex run`). */
  name: string;
  /**
   * ISO 8601 UTC timestamp recording when this migration was added to the registry.
   * For historical reference — does not affect execution order or behavior.
   */
  addedAt: string;
}

/**
 * List of migrations to run, in order.
 * Each entry specifies the Convex function path and when the migration was added.
 *
 * ALL migrations must be idempotent — they are run on every deploy.
 *
 * ─── Cleanup Checklist ───────────────────────────────────────────────────────
 * When a migration has been running in production long enough that all old
 * documents have been cleaned up, remove it from this list AND from migration.ts,
 * AND update the "Previously executed" comment in migration.ts.
 */
const MIGRATIONS: Migration[] = [
  {
    name: 'migration:migrateAvailableModelsToPerHarness',
    addedAt: '2025-01-01T00:00:00.000Z', // exact date unknown — grandfathered
  },
  {
    name: 'migration:stripParticipantStaleFields',
    addedAt: '2025-01-01T00:00:00.000Z', // exact date unknown — grandfathered
  },
  {
    name: 'migration:deleteOldFormatAgentPreferences',
    addedAt: '2026-02-27T07:53:09.000Z',
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────

console.log(`\n🚀 Running ${MIGRATIONS.length} migration(s)...\n`);

let passed = 0;
let failed = 0;

for (const migration of MIGRATIONS) {
  process.stdout.write(`  ▶ ${migration.name} (added ${migration.addedAt}) ... `);
  try {
    const result =
      await $`npx convex run ${migration.name} --prod`.cwd(BACKEND_DIR).quiet();
    const output = result.stdout.toString().trim();
    console.log(`✅`);
    if (output) {
      console.log(`     ${output}`);
    }
    passed++;
  } catch (err) {
    console.log(`❌`);
    const error = err as { stderr?: Buffer; message?: string };
    const stderr = error.stderr?.toString().trim() ?? error.message ?? String(err);
    console.error(`     ${stderr}`);
    failed++;
  }
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed}/${MIGRATIONS.length} migrations succeeded.\n`);

if (failed > 0) {
  process.exit(1);
}
