#!/usr/bin/env bun
/**
 * Start Convex dev using the backend version saved for the local deployment.
 *
 * Pinning the version avoids prompting for a local backend upgrade on every
 * startup. A successful upgrade can still update config.json, so the pin
 * follows the deployment's recorded version automatically.
 *
 * Flow: refuse production or a deploy key → `convex dev --once` pushes the code → watcher starts →
 * pending migrations run in the background against the same deployment.
 */

import { appendFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { applyConvexDevEnvDefaults } from './convex-dev-env';
import {
  backendEnvPath,
  deployKeySource,
  describeConvexTarget,
  localBackendConfigPath,
  readBackendEnvFile,
  readEnvValue,
  resolveDevTarget,
} from './convex-target';
import { devMigrationSkipReason, devStartRefusal, runDevMigrationsSafely } from './dev-migrations';

const repoRoot = resolve(dirname(import.meta.path), '..');
const backendDir = resolve(repoRoot, 'services/backend');
const backendVersionEnvName = 'CONVEX_LOCAL_BACKEND_VERSION';

type LocalConfig = {
  backendVersion?: unknown;
};

export function buildConvexDevArgs(
  isLocal: boolean,
  backendVersion: string | undefined,
  extraArgs: string[] = []
): string[] {
  const args = ['pnpm', 'exec', 'convex', 'dev'];
  if (isLocal && backendVersion) {
    args.push('--local-backend-version', backendVersion);
  }
  return [...args, ...extraArgs];
}

async function readBackendVersion(): Promise<string> {
  const env = await readBackendEnvFile();
  const envValue = readEnvValue(env, backendVersionEnvName);

  if (envValue) {
    return envValue;
  }

  let config: LocalConfig;

  try {
    config = JSON.parse(await readFile(localBackendConfigPath, 'utf8')) as LocalConfig;
  } catch (error) {
    throw new Error(
      `Could not read local Convex config at ${localBackendConfigPath}. Run Convex setup first.`,
      { cause: error }
    );
  }

  if (typeof config.backendVersion !== 'string' || config.backendVersion.length === 0) {
    throw new Error(`No backendVersion is configured in ${localBackendConfigPath}.`);
  }

  const separator = env.length > 0 && !env.endsWith('\n') ? '\n' : '';
  await appendFile(
    backendEnvPath,
    `${separator}${backendVersionEnvName}=${config.backendVersion}\n`
  );
  console.log(`Saved ${backendVersionEnvName} to ${backendEnvPath}`);
  return config.backendVersion;
}

function spawnConvexDev(args: string[]) {
  return Bun.spawn(args, {
    cwd: backendDir,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
}

async function main(): Promise<void> {
  applyConvexDevEnvDefaults();
  const env = process.env;
  const envFile = await readBackendEnvFile();
  const target = resolveDevTarget({ env, envFile });

  const refusal = devStartRefusal(target, deployKeySource({ env, envFile }));
  if (refusal) {
    console.error(`❌ ${refusal}`);
    process.exit(1);
  }

  const isLocalDeployment = target.kind === 'local';
  const backendVersion = isLocalDeployment ? await readBackendVersion() : undefined;
  const extraArgs = process.argv.slice(2);
  const watchArgs = buildConvexDevArgs(isLocalDeployment, backendVersion, extraArgs);

  console.log(
    `Starting Convex dev for ${describeConvexTarget(target)}${backendVersion ? ` with local backend version ${backendVersion}` : ''}`
  );

  const skipReason = devMigrationSkipReason(target, env);
  if (skipReason) {
    console.log(`⏭️  Skipping dev migrations: ${skipReason}.`);
    process.exit(await spawnConvexDev(watchArgs).exited);
  }

  // `convex dev --once` pushes the code and exits. A local backend stops with it, so the
  // watcher below starts it again. Migrations wait for it to answer `convex run`.
  const pushArgs = buildConvexDevArgs(isLocalDeployment, backendVersion, [...extraArgs, '--once']);
  const pushExitCode = await spawnConvexDev(pushArgs).exited;
  if (pushExitCode === 0) {
    void runDevMigrationsSafely(target);
  } else {
    console.warn(
      `⚠️  Skipping dev migrations: the initial push (convex dev --once) exited with ${pushExitCode}. Fix the error, then run \`pnpm migrate\`. The watcher is starting anyway.`
    );
  }

  process.exit(await spawnConvexDev(watchArgs).exited);
}

if (import.meta.main) {
  await main();
}
