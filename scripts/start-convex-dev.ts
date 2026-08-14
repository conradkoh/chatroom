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

/**
 * Convex local deployments expose their cloud endpoint on loopback. Hosted
 * deployments use a public endpoint (normally a *.convex.cloud URL).
 */
export function isLocalConvexUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0'
    );
  } catch {
    return false;
  }
}

function readEnvValue(env: string, name: string): string | undefined {
  const match = env.match(new RegExp(`^\\s*${name}\\s*=\\s*([^#\\r\\n]+?)\\s*(?:#.*)?$`, 'm'));
  return match?.[1]?.trim() || undefined;
}

async function readBackendEnv(): Promise<Record<string, string>> {
  const env = await readFile(envPath, 'utf8').catch(() => '');
  return {
    VITE_CONVEX_URL: readEnvValue(env, 'VITE_CONVEX_URL') ?? readEnvValue(env, 'CONVEX_URL') ?? '',
    CONVEX_DEPLOYMENT: readEnvValue(env, 'CONVEX_DEPLOYMENT') ?? '',
  };
}

export function buildConvexDevArgs(
  convexUrl: string | undefined,
  backendVersion: string | undefined,
  extraArgs: string[] = [],
  localDeployment = isLocalConvexUrl(convexUrl)
): string[] {
  const args = ['pnpm', 'exec', 'convex', 'dev'];
  if (localDeployment && backendVersion) {
    args.push('--local-backend-version', backendVersion);
  }
  return [...args, ...extraArgs];
}

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

async function main(): Promise<void> {
  const backendEnv = await readBackendEnv();
  const convexUrl =
    process.env.VITE_CONVEX_URL || process.env.CONVEX_URL || backendEnv.VITE_CONVEX_URL;
  const isLocalDeployment =
    isLocalConvexUrl(convexUrl) || backendEnv.CONVEX_DEPLOYMENT.startsWith('local:');
  const backendVersion = isLocalDeployment ? await readBackendVersion() : undefined;
  const args = buildConvexDevArgs(
    convexUrl,
    backendVersion,
    process.argv.slice(2),
    isLocalDeployment
  );

  console.log(
    `Starting ${isLocalDeployment ? 'local' : 'hosted'} Convex dev${backendVersion ? ` with local backend version ${backendVersion}` : ''}`
  );

  const child = Bun.spawn(args, {
    cwd: backendDir,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  process.exit(await child.exited);
}

if (import.meta.main) {
  await main();
}
