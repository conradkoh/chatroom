import path from 'path';
import { fileURLToPath } from 'url';

import { $ } from 'bun';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../services/backend');
const MIGRATION_POLL_INTERVAL_MS = 1_000;
const MIGRATION_TIMEOUT_MS = 30 * 60 * 1_000;

type MigrationStatus = {
  name: string;
  isDone: boolean;
  state: string;
  error?: string;
};

export function isLocalMigrationTarget(): boolean {
  return !process.env.CONVEX_DEPLOY_KEY;
}

function convexRun(functionName: string) {
  return isLocalMigrationTarget()
    ? $`npx convex run ${functionName}`.cwd(BACKEND_DIR)
    : $`npx convex run ${functionName} --prod`.cwd(BACKEND_DIR);
}

async function getMigrationStatus(): Promise<MigrationStatus[]> {
  const output = await convexRun('migrations:getRunAllStatus').text();
  return JSON.parse(output) as MigrationStatus[];
}

function getPendingMigrations(statuses: MigrationStatus[]): MigrationStatus[] {
  const firstIncompleteIndex = statuses.findIndex((status) => !status.isDone);
  return firstIncompleteIndex === -1
    ? []
    : statuses.slice(firstIncompleteIndex).filter((status) => !status.isDone);
}

function getLatestCompletedMigration(statuses: MigrationStatus[]): string | undefined {
  let latestCompleted: string | undefined;

  for (const status of statuses) {
    if (!status.isDone) break;
    latestCompleted = status.name;
  }

  return latestCompleted;
}

function logMigrationPlan(statuses: MigrationStatus[]): MigrationStatus[] {
  const latestCompleted = getLatestCompletedMigration(statuses);
  const pending = getPendingMigrations(statuses);

  console.log(`📍 Latest completed migration: ${latestCompleted ?? '(none)'}`);

  if (pending.length === 0) {
    console.log('✅ No pending migrations.\n');
    return pending;
  }

  console.log('⏳ Pending migrations (in order):');
  for (const migration of pending) {
    console.log(`   - ${migration.name}`);
  }
  console.log('');

  return pending;
}

export async function runMigrations(): Promise<void> {
  const initialStatuses = await getMigrationStatus();
  const pending = logMigrationPlan(initialStatuses);

  if (pending.length === 0) return;

  console.log('🚀 Running pending migrations in sequence...\n');
  await convexRun('migrations:runAll').text();

  const pendingNames = new Set(pending.map((migration) => migration.name));
  const completedNames = new Set<string>();
  const deadline = Date.now() + MIGRATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const statuses = await getMigrationStatus();
    const statusByName = new Map(statuses.map((status) => [status.name, status]));

    for (const name of pendingNames) {
      const status = statusByName.get(name);
      if (status?.isDone && !completedNames.has(name)) {
        completedNames.add(name);
        console.log(`   ✅ ${name}`);
      }
    }

    const failed = statuses.find(
      (status) =>
        pendingNames.has(status.name) && (status.state === 'failed' || status.state === 'canceled')
    );
    if (failed) {
      throw new Error(`${failed.name} ${failed.state}${failed.error ? `: ${failed.error}` : ''}`);
    }

    if (pending.every((migration) => statusByName.get(migration.name)?.isDone)) {
      console.log('');
      return;
    }

    await Bun.sleep(MIGRATION_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out after ${MIGRATION_TIMEOUT_MS / 60_000} minutes while waiting for pending migrations.`
  );
}
