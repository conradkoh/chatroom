import path from 'path';
import { fileURLToPath } from 'url';

import { $ } from 'bun';

import { buildConvexDevEnv } from './convex-dev-env';
import {
  buildConvexRunArgs,
  type ConvexTarget,
  readBackendEnvFile,
  resolveConvexTarget,
} from './convex-target';

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

/** Resolve the target for this run: production iff CONVEX_DEPLOY_KEY is set, else the dev deployment. */
export async function resolveMigrationTarget(): Promise<ConvexTarget> {
  return resolveConvexTarget({
    deployKey: process.env.CONVEX_DEPLOY_KEY,
    env: process.env,
    envFile: await readBackendEnvFile(),
  });
}

/**
 * Environment for a `convex run` child. A local deployment never receives TZ, because a local
 * backend refuses a non-UTC zone. Hosted and production children keep the environment.
 */
// Exported for scripts/migrate-lib.spec.ts; spec files are not fallow analysis entries.
// fallow-ignore-next-line unused-export
export function convexRunEnv(
  target: ConvexTarget,
  baseEnv: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  return buildConvexDevEnv(baseEnv, target.kind === 'local');
}

function convexRun(target: ConvexTarget, functionName: string) {
  return $`npx convex ${buildConvexRunArgs(target, functionName)}`
    .cwd(BACKEND_DIR)
    .env(convexRunEnv(target, process.env));
}

export async function getMigrationStatus(target: ConvexTarget): Promise<MigrationStatus[]> {
  const output = await convexRun(target, 'migrations:getRunAllStatus').text();
  return JSON.parse(output) as MigrationStatus[];
}

function isRecordWithStderr(err: unknown): err is { stderr: unknown } {
  return typeof err === 'object' && err !== null && (err as { stderr?: unknown }).stderr != null;
}

/** Trimmed stderr of a failed `convex run`, when the error carries one. */
function stderrText(err: unknown): string | undefined {
  const stderr = isRecordWithStderr(err) ? String(err.stderr).trim() : '';
  return stderr || undefined;
}

/** Text for a failed `convex run`: its stderr when present, else the error message. */
export function describeMigrationError(err: unknown): string {
  return stderrText(err) ?? (err instanceof Error ? err.message : String(err));
}

type AcceptOptions = { timeoutMs: number; intervalMs: number };

/** Reject if `work` does not settle within `ms`. The timer is cleared either way. */
async function settleWithin<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call `probe` until it resolves. Fail after `timeoutMs` with the last probe error.
 * `probe` is the only port to the deployment: the Convex CLI in production, a fake in tests.
 * Every probe is bounded by the remaining time, so a probe that never settles cannot hang the wait.
 */
export async function waitForAcceptance(
  probe: () => Promise<unknown>,
  { timeoutMs, intervalMs }: AcceptOptions
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await settleWithin(probe(), Math.max(1, deadline - Date.now()));
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the deployment to accept convex run: ${describeMigrationError(error)}`
        );
      }
    }
    await Bun.sleep(intervalMs);
  }
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

function isPendingAndDone(status: MigrationStatus, pendingNames: Set<string>): boolean {
  return pendingNames.has(status.name) && status.isDone;
}

/** Log migrations that completed since the last poll. */
function logNewlyCompleted(
  pendingNames: Set<string>,
  statuses: MigrationStatus[],
  completedNames: Set<string>
): void {
  for (const status of statuses) {
    if (!isPendingAndDone(status, pendingNames) || completedNames.has(status.name)) continue;
    completedNames.add(status.name);
    console.log(`   ✅ ${status.name}`);
  }
}

function findFailedMigration(
  pendingNames: Set<string>,
  statuses: MigrationStatus[]
): MigrationStatus | undefined {
  return statuses.find(
    (status) =>
      pendingNames.has(status.name) && (status.state === 'failed' || status.state === 'canceled')
  );
}

function throwIfFailed(pendingNames: Set<string>, statuses: MigrationStatus[]): void {
  const failed = findFailedMigration(pendingNames, statuses);
  if (!failed) return;
  throw new Error(`${failed.name} ${failed.state}${failed.error ? `: ${failed.error}` : ''}`);
}

function allPendingCompleted(pending: MigrationStatus[], statuses: MigrationStatus[]): boolean {
  const statusByName = new Map(statuses.map((status) => [status.name, status]));
  return pending.every((migration) => statusByName.get(migration.name)?.isDone);
}

async function waitForMigrations(target: ConvexTarget, pending: MigrationStatus[]): Promise<void> {
  const pendingNames = new Set(pending.map((migration) => migration.name));
  const completedNames = new Set<string>();
  const deadline = Date.now() + MIGRATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const statuses = await getMigrationStatus(target);
    logNewlyCompleted(pendingNames, statuses, completedNames);
    throwIfFailed(pendingNames, statuses);

    if (allPendingCompleted(pending, statuses)) {
      console.log('');
      return;
    }

    await Bun.sleep(MIGRATION_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out after ${MIGRATION_TIMEOUT_MS / 60_000} minutes while waiting for pending migrations.`
  );
}

export async function runMigrations(target: ConvexTarget): Promise<void> {
  const initialStatuses = await getMigrationStatus(target);
  const pending = logMigrationPlan(initialStatuses);

  if (pending.length === 0) return;

  console.log('🚀 Running pending migrations in sequence...\n');
  await convexRun(target, 'migrations:runAll').text();
  await waitForMigrations(target, pending);
}
