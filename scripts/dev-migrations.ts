import { readFile } from 'node:fs/promises';

import {
  type ConvexTarget,
  type DeployKeySource,
  describeConvexTarget,
  localBackendConfigPath,
  localBackendProbeUrl,
} from './convex-target';
import {
  describeMigrationError,
  getMigrationStatus,
  runMigrations,
  waitForAcceptance,
} from './migrate-lib';

/** Set to exactly `1` to skip dev migrations for one `pnpm dev` run. */
const SKIP_DEV_MIGRATIONS_ENV = 'SKIP_DEV_MIGRATIONS';

/** How long the dev watcher's deployment may take to answer `convex run`. */
const ACCEPT_TIMEOUT_MS = 120_000;
const ACCEPT_INTERVAL_MS = 2_000;

/** Why dev runs no migrations for this target, or undefined when it should run them. */
export function devMigrationSkipReason(
  target: ConvexTarget,
  env: Record<string, string | undefined>
): string | undefined {
  if (env[SKIP_DEV_MIGRATIONS_ENV] === '1') return `${SKIP_DEV_MIGRATIONS_ENV}=1 is set`;
  return targetSkipReason(target);
}

const UNCONFIGURED_SKIP_REASON =
  'no development deployment is configured yet (run `npx convex dev` once in services/backend to set one up)';
const PRODUCTION_SKIP_REASON = 'the target is production, which dev never migrates';
const DEPLOY_KEY_IN_FILE_SKIP_REASON =
  'CONVEX_DEPLOY_KEY is set in services/backend/.env.local, and dev never migrates a deploy-key deployment';

function targetSkipReason(target: ConvexTarget): string | undefined {
  if (target.kind === 'unconfigured') return UNCONFIGURED_SKIP_REASON;
  if (target.kind === 'deploy-key-in-file') return DEPLOY_KEY_IN_FILE_SKIP_REASON;
  return isProductionTarget(target) ? PRODUCTION_SKIP_REASON : undefined;
}

/** Both production kinds are refused identically by dev. */
function isProductionTarget(target: ConvexTarget): boolean {
  return target.kind === 'production' || target.kind === 'prod-without-key';
}

/**
 * Message to print before refusing to start `convex dev`, or undefined when dev may start.
 * A `prod:` selector is refused first, with or without a key. Then a set deploy key is refused.
 */
export function devStartRefusal(
  target: ConvexTarget,
  deployKey?: DeployKeySource
): string | undefined {
  if (target.kind === 'prod-without-key') {
    return `Refusing to start Convex dev: ${describeConvexTarget(target)}. pnpm dev never runs against production. Nothing was started and no migrations ran. Set CONVEX_DEPLOYMENT in your shell or services/backend/.env.local to a dev: or local: deployment.`;
  }
  return deployKey ? deployKeyRefusal(deployKey) : undefined;
}

function deployKeyRefusal(source: DeployKeySource): string {
  const fix =
    source === 'process environment'
      ? 'run `unset CONVEX_DEPLOY_KEY` in your shell'
      : 'remove CONVEX_DEPLOY_KEY from services/backend/.env.local';
  return `Refusing to start Convex dev: CONVEX_DEPLOY_KEY is set in ${source}. A deploy key selects its own deployment, which may be production, and dev never starts or migrates one. Nothing was started and no migrations ran. To fix: ${fix}, then run pnpm dev again.`;
}

/** Wait for the deployment to accept `convex run`, then run pending migrations. Throws on failure. */
async function runDevMigrations(target: ConvexTarget): Promise<void> {
  console.log(`🗂️  Dev migrations against ${describeConvexTarget(target)}`);
  await waitForLocalBackend(target);
  // known limitation: a probe that times out is not killed. Its `npx convex run` child may still
  // be running after this throws. The watcher is unaffected.
  await waitForAcceptance(() => getMigrationStatus(target), {
    timeoutMs: ACCEPT_TIMEOUT_MS,
    intervalMs: ACCEPT_INTERVAL_MS,
  });
  await runMigrations(target);
}

/**
 * A local backend must answer before the first `convex run`. Otherwise the CLI may start its own
 * backend for the probe and stop it on exit, taking the watcher's deployment down with it.
 * Waits on the target's URL, or on the port the local deployment recorded. Refuses to probe when
 * neither is known, so no migration runs before the backend is known to answer.
 * Hosted deployments are always reachable.
 */
async function waitForLocalBackend(target: ConvexTarget): Promise<void> {
  if (target.kind !== 'local') return;
  const configText = await readFile(localBackendConfigPath, 'utf8').catch(() => '');
  const url = localBackendProbeUrl(target, configText);
  if (!url) {
    throw new Error(
      `No local backend port is known. Set CONVEX_URL in services/backend/.env.local, or run \`npx convex dev\` once to create ${localBackendConfigPath}. Migrations were not run.`
    );
  }
  await waitForAcceptance(() => fetch(url), {
    timeoutMs: ACCEPT_TIMEOUT_MS,
    intervalMs: ACCEPT_INTERVAL_MS,
  });
}

/** Background entry for `pnpm dev`. Never throws: a failure is a warning, so the watcher keeps running. */
export async function runDevMigrationsSafely(target: ConvexTarget): Promise<void> {
  try {
    await runDevMigrations(target);
  } catch (error) {
    console.warn(
      `\n⚠️  Dev migrations did not complete against ${describeConvexTarget(target)}:\n   ${describeMigrationError(error)}\n   The dev watcher keeps running. Fix the problem, then run \`pnpm migrate\`. Set SKIP_DEV_MIGRATIONS=1 to skip this step.\n`
    );
  }
}
