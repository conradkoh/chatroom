#!/usr/bin/env bun
/**
 * Start Convex dev using the backend version saved for the local deployment.
 *
 * Pinning the version avoids prompting for a local backend upgrade on every
 * startup. A successful upgrade can still update config.json, so the pin
 * follows the deployment's recorded version automatically.
 */

import { appendFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(import.meta.path), '..');
const backendDir = resolve(repoRoot, 'services/backend');
const configPath = resolve(backendDir, '.convex/local/default/config.json');
const envPath = resolve(backendDir, '.env.local');
const backendVersionEnvName = 'CONVEX_LOCAL_BACKEND_VERSION';

type LocalConfig = {
  backendVersion?: unknown;
};

async function readBackendVersion(): Promise<string> {
  const env = await readFile(envPath, 'utf8').catch(() => '');
  const envMatch = env.match(
    new RegExp(`^\\s*${backendVersionEnvName}\\s*=\\s*([^#\\r\\n]+?)\\s*(?:#.*)?$`, 'm')
  );

  if (envMatch?.[1]) {
    return envMatch[1].trim();
  }

  let config: LocalConfig;

  try {
    config = JSON.parse(await readFile(configPath, 'utf8')) as LocalConfig;
  } catch (error) {
    throw new Error(
      `Could not read local Convex config at ${configPath}. Run Convex setup first.`,
      { cause: error }
    );
  }

  if (typeof config.backendVersion !== 'string' || config.backendVersion.length === 0) {
    throw new Error(`No backendVersion is configured in ${configPath}.`);
  }

  const separator = env.length > 0 && !env.endsWith('\n') ? '\n' : '';
  await appendFile(envPath, `${separator}${backendVersionEnvName}=${config.backendVersion}\n`);
  console.log(`Saved ${backendVersionEnvName} to ${envPath}`);
  return config.backendVersion;
}

const backendVersion = await readBackendVersion();
console.log(`Starting Convex dev with local backend version ${backendVersion}`);

const child = Bun.spawn(
  [
    'pnpm',
    'exec',
    'convex',
    'dev',
    '--local-backend-version',
    backendVersion,
    ...process.argv.slice(2),
  ],
  {
    cwd: backendDir,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }
);

process.exit(await child.exited);
