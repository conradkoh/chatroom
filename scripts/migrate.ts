#!/usr/bin/env bun

/**
 * Database Migration Runner
 *
 * Runs all pending Convex database migrations. Automatically targets:
 *   - LOCAL development server — when CONVEX_DEPLOY_KEY is not set (default)
 *   - PRODUCTION deployment    — when CONVEX_DEPLOY_KEY is set (e.g. in CI)
 *
 * All migrations are idempotent — safe to run multiple times.
 *
 * Usage:
 *   pnpm run migrate
 *
 * Environment:
 *   CONVEX_DEPLOY_KEY  — when set, targets production; otherwise targets local dev
 */

import { $ } from 'bun';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../services/backend');

// ─── Environment Detection ───────────────────────────────────────────────────

// Production is inferred from CONVEX_DEPLOY_KEY being set (e.g. in CI).
// Otherwise, assume local development — requires `convex dev` to be running.
const isLocal = !process.env.CONVEX_DEPLOY_KEY;

if (isLocal) {
  console.log('🏠 Running migrations against LOCAL development server.');
  console.log('   Make sure `convex dev` is running in another terminal.\n');
} else {
  console.log('☁️  Running migrations against PRODUCTION deployment.\n');
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
  {
    name: 'migration:deleteLegacyMessageQueueDocuments',
    addedAt: '2026-03-04T11:27:00.000Z',
  },
  {
    name: 'migration:migrateQueuedTasks',
    addedAt: '2026-03-06T05:35:00.000Z',
  },
  {
    name: 'migration:migrateTeamRoleKeyAddTeamId',
    addedAt: '2026-03-08T08:45:00.000Z',
  },
  {
    name: 'migration:migrateStopReasonToActorPrefixed',
    addedAt: '2026-03-09T00:00:00.000Z',
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────

const convexArgs = isLocal ? [] : ['--prod'];

console.log(`🚀 Running ${MIGRATIONS.length} migration(s)...\n`);

let passed = 0;
let failed = 0;

for (const migration of MIGRATIONS) {
  process.stdout.write(`  ▶ ${migration.name} (added ${migration.addedAt}) ... `);
  try {
    const cmd = convexArgs.length > 0
      ? $`npx convex run ${migration.name} ${convexArgs[0]}`.cwd(BACKEND_DIR).quiet()
      : $`npx convex run ${migration.name}`.cwd(BACKEND_DIR).quiet();
    const result = await cmd;
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
