import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** services/backend/.env.local — the file `convex dev` reads for the development deployment. */
export const backendEnvPath = resolve(
  dirname(import.meta.path),
  '..',
  'services',
  'backend',
  '.env.local'
);

/** services/backend/.convex/local/default/config.json — written by the local backend. `ports.cloud` is its API port. */
export const localBackendConfigPath = resolve(
  dirname(import.meta.path),
  '..',
  'services',
  'backend',
  '.convex',
  'local',
  'default',
  'config.json'
);

/**
 * The development deployment `convex dev` uses, or a state that must never be migrated.
 * `deployment` and `url` are not secrets.
 */
export type DevTarget =
  | { kind: 'local'; deployment?: string; url?: string }
  | { kind: 'hosted-dev'; deployment?: string; url?: string }
  /** CONVEX_DEPLOYMENT selects PRODUCTION. Dev never runs against production. */
  | { kind: 'prod-without-key'; deployment: string }
  /** No usable CONVEX_DEPLOYMENT selector and no CONVEX_URL / VITE_CONVEX_URL. */
  | { kind: 'unconfigured' };

type EnvInput = {
  /** Process environment. Takes precedence over `envFile`, as the Convex CLI does. */
  env?: Record<string, string | undefined>;
  /** Raw text of services/backend/.env.local. */
  envFile?: string;
};

/** `NAME=rest-of-line`, optional `export ` prefix. Matches one line only. */
const ENV_ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Value of `name` in dotenv-style text. Deliberate limits, not the full dotenv grammar:
 * - Callers read services/backend/.env.local only, never `.env`.
 * - The first assignment of `name` wins. dotenv keeps the last one, so a duplicated name can be
 *   classified differently from the Convex CLI. This is not modelled.
 * - Multi-line quoted values are unsupported. A quote left open on its line yields undefined.
 * Single line only: an empty `NAME=` is undefined, never the next line.
 */
export function readEnvValue(envFile: string, name: string): string | undefined {
  for (const line of envFile.split(/\r?\n/)) {
    const match = ENV_ASSIGNMENT.exec(line);
    if (!match) continue;
    if (match[1] !== name) continue;
    return parseEnvValue(match[2]);
  }
  return undefined;
}

/** Quoted: text between matching quotes (rest ignored). Unquoted: text before an inline ` #` comment. */
function parseEnvValue(rawValue: string): string | undefined {
  const value = rawValue.trim();
  const quote = value.charAt(0);
  if (quote === '"' || quote === "'") return unquote(value, quote);
  return stripInlineComment(value);
}

function unquote(value: string, quote: string): string | undefined {
  const closing = value.indexOf(quote, 1);
  if (closing === -1) return undefined;
  return value.slice(1, closing).trim() || undefined;
}

function stripInlineComment(value: string): string | undefined {
  return value.replace(/(^|\s)#.*$/, '').trim() || undefined;
}

/** Hostnames that only a local Convex deployment exposes its endpoint on. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** First non-empty candidate. */
function firstNonEmpty(...candidates: (string | undefined)[]): string | undefined {
  return candidates.find((candidate) => Boolean(candidate));
}

/** An explicit selector is authoritative. The URL is only consulted to drop a stale loopback. */
function targetFromSelector(deployment: string, url: string | undefined): DevTarget {
  if (deployment.startsWith('prod:')) return { kind: 'prod-without-key', deployment };
  const devKind = devKindFromSelector(deployment);
  if (devKind === 'local') return { kind: 'local', deployment, url };
  if (devKind === 'hosted-dev') return hostedDevTarget(deployment, url);
  return { kind: 'unconfigured' };
}

/**
 * A loopback URL is stale under an explicit `dev:` selector, because `dev:` is always hosted.
 * Drop it instead of labelling a hosted deployment with a local address.
 */
function hostedDevTarget(deployment: string, url: string | undefined): DevTarget {
  return url && !isLoopbackUrl(url)
    ? { kind: 'hosted-dev', deployment, url }
    : { kind: 'hosted-dev', deployment };
}

/** `local:` and `anonymous:` are local deployments; `dev:` is hosted. */
function devKindFromSelector(deployment: string): 'local' | 'hosted-dev' | undefined {
  if (deployment.startsWith('local:') || deployment.startsWith('anonymous:')) return 'local';
  if (deployment.startsWith('dev:')) return 'hosted-dev';
  return undefined;
}

/** Classify the development deployment `convex dev` uses. Ignores CONVEX_DEPLOY_KEY. */
export function resolveDevTarget({ env = {}, envFile = '' }: EnvInput = {}): DevTarget {
  const deployment = firstNonEmpty(
    env.CONVEX_DEPLOYMENT,
    readEnvValue(envFile, 'CONVEX_DEPLOYMENT')
  );
  const url = firstNonEmpty(
    env.VITE_CONVEX_URL,
    env.CONVEX_URL,
    readEnvValue(envFile, 'VITE_CONVEX_URL'),
    readEnvValue(envFile, 'CONVEX_URL')
  );
  if (deployment) return targetFromSelector(deployment, url);
  if (url) return { kind: isLoopbackUrl(url) ? 'local' : 'hosted-dev', url };
  return { kind: 'unconfigured' };
}

export async function readBackendEnvFile(): Promise<string> {
  return readFile(backendEnvPath, 'utf8').catch(() => '');
}

/** Where CONVEX_DEPLOY_KEY is set for dev, or undefined. An empty value counts as unset. */
export type DeployKeySource = 'process environment' | 'services/backend/.env.local';

/** Source of a non-empty CONVEX_DEPLOY_KEY. The process env is checked first. The key value is never returned. */
export function deployKeySource({ env = {}, envFile = '' }: EnvInput = {}):
  DeployKeySource | undefined {
  if (env.CONVEX_DEPLOY_KEY) return 'process environment';
  if (readEnvValue(envFile, 'CONVEX_DEPLOY_KEY')) return 'services/backend/.env.local';
  return undefined;
}

/** What a migration run targets: production (CI, deploy key in the process env) or the development deployment. */
export type ConvexTarget =
  | { kind: 'production' }
  /**
   * CONVEX_DEPLOY_KEY is set in services/backend/.env.local. `convex run` may then target that
   * deployment without --prod, so nothing runs.
   */
  | { kind: 'deploy-key-in-file' }
  | DevTarget;

/**
 * URL to probe for a local backend: the target's URL, else `ports.cloud` in the deployment's
 * config.json. Undefined when neither is known, and for every non-local target.
 */
export function localBackendProbeUrl(target: ConvexTarget, configText: string): string | undefined {
  if (target.kind !== 'local') return undefined;
  if (target.url) return target.url;
  const port = recordedCloudPort(configText);
  return port === undefined ? undefined : `http://127.0.0.1:${port}`;
}

/** `ports.cloud` from a local deployment's config.json, when present and a number. */
function recordedCloudPort(configText: string): number | undefined {
  try {
    const port = (JSON.parse(configText) as { ports?: { cloud?: unknown } }).ports?.cloud;
    return typeof port === 'number' ? port : undefined;
  } catch {
    return undefined;
  }
}

type ConvexTargetInput = EnvInput & {
  /** CONVEX_DEPLOY_KEY. When set (non-empty) the target is production. */
  deployKey?: string;
};

/**
 * Production iff `deployKey` (the process env key, CI) is set. A key found only in
 * services/backend/.env.local is refused, not used. Otherwise the development deployment
 * `convex dev` uses.
 */
export function resolveConvexTarget({ deployKey, ...input }: ConvexTargetInput = {}): ConvexTarget {
  if (deployKey) return { kind: 'production' };
  if (readEnvValue(input.envFile ?? '', 'CONVEX_DEPLOY_KEY')) return { kind: 'deploy-key-in-file' };
  return resolveDevTarget(input);
}

/** Why migrations must not run against this target, or undefined when they may run. */
export function unrunnableReason(target: ConvexTarget): string | undefined {
  switch (target.kind) {
    case 'prod-without-key':
      return `CONVEX_DEPLOYMENT=${target.deployment} selects PRODUCTION. Nothing was run. Production migrations run only with CONVEX_DEPLOY_KEY set in the process environment (CI). To migrate development, point CONVEX_DEPLOYMENT in your shell or services/backend/.env.local at a dev: or local: deployment.`;
    case 'deploy-key-in-file':
      return 'CONVEX_DEPLOY_KEY is set in services/backend/.env.local, so `convex run` may target that deployment without --prod. Nothing was run. To migrate production, set CONVEX_DEPLOY_KEY in the process environment (CI). To migrate development, remove CONVEX_DEPLOY_KEY from services/backend/.env.local.';
    case 'unconfigured':
      return 'No development deployment is configured. Nothing was run. Run `npx convex dev` in services/backend once to configure a deployment, or set CONVEX_DEPLOY_KEY to target production.';
    default:
      return undefined;
  }
}

/**
 * Arguments for `npx convex <args>`. `--prod` only for production. Without it the Convex CLI
 * resolves the development deployment from services/backend/.env.local, as `convex dev` does.
 * Throws for targets that must not run (see `unrunnableReason`).
 */
export function buildConvexRunArgs(target: ConvexTarget, functionName: string): string[] {
  const reason = unrunnableReason(target);
  if (reason) throw new Error(reason);
  return target.kind === 'production' ? ['run', functionName, '--prod'] : ['run', functionName];
}

const PRODUCTION_LABEL = 'PRODUCTION deployment (CONVEX_DEPLOY_KEY is set)';
const UNCONFIGURED_LABEL =
  'UNCONFIGURED: no usable CONVEX_DEPLOYMENT or CONVEX_URL in the environment or services/backend/.env.local';
const DEPLOY_KEY_IN_FILE_LABEL =
  'CONVEX_DEPLOY_KEY is set in services/backend/.env.local (not run)';

/**
 * Human-readable migration target. Contains deployment name and URL only, never keys.
 * Split into small helpers so each stays simple and the strings stay exhaustive.
 */
export function describeConvexTarget(target: ConvexTarget): string {
  if (target.kind === 'prod-without-key') return describeProdSelected(target.deployment);
  if (target.kind === 'unconfigured') return UNCONFIGURED_LABEL;
  if (target.kind === 'deploy-key-in-file') return DEPLOY_KEY_IN_FILE_LABEL;
  return describeRunnableTarget(target);
}

function describeRunnableTarget(
  target: Extract<ConvexTarget, { kind: 'production' | 'local' | 'hosted-dev' }>
): string {
  if (target.kind === 'production') return PRODUCTION_LABEL;
  return describeDevelopmentTarget(target);
}

function describeDevelopmentTarget(
  target: Extract<DevTarget, { kind: 'local' | 'hosted-dev' }>
): string {
  if (target.kind === 'local') return describeLocalTarget(target.deployment);
  return describeHostedDevTarget(target.deployment, target.url);
}

function describeLocalTarget(deployment: string | undefined): string {
  return deployment ? `LOCAL development server (${deployment})` : 'LOCAL development server';
}

function describeHostedDevTarget(deployment: string | undefined, url: string | undefined): string {
  const name = deployment
    ? `HOSTED development deployment ${deployment}`
    : 'HOSTED development deployment';
  return url ? `${name} at ${url}` : name;
}

/** Unconditional: the selector is production whether or not a key is set. */
function describeProdSelected(deployment: string): string {
  return `PRODUCTION deployment ${deployment} selected by CONVEX_DEPLOYMENT`;
}
