/**
 * Default env vars for Convex dev/codegen.
 * Set in Bun scripts instead of package.json so Windows (cmd/PowerShell) works.
 */
const CONVEX_DEV_ENV_DEFAULTS = {
  CONVEX_NON_INTERACTIVE: 'true',
  DOCUMENT_RETENTION_DELAY: '1',
  INDEX_RETENTION_DELAY: '1',
  RETENTION_DELETE_FREQUENCY: '10',
} as const;

/**
 * Inherited variables that select a Convex backend or deployment on their own.
 * They are removed from the child env so they cannot redirect the dev server.
 * CONVEX_DEPLOYMENT is handled separately: it is always overwritten with the
 * configured value.
 */
const DEPLOYMENT_SELECTOR_ENV_NAMES = [
  'CONVEX_DEPLOY_KEY',
  'CONVEX_SELF_HOSTED_URL',
  'CONVEX_SELF_HOSTED_ADMIN_KEY',
] as const;

export function applyConvexDevEnvDefaults(): void {
  for (const [key, value] of Object.entries(CONVEX_DEV_ENV_DEFAULTS)) {
    process.env[key] ??= value;
  }
}

/**
 * Names (never values) of inherited variables that conflict with the configured
 * deployment and will be overridden or removed by buildConvexDevEnv. Safe to log.
 * Order is fixed: CONVEX_DEPLOYMENT first, then the selector names in list order.
 */
export function findConflictingDeploymentEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  configuredDeployment: string
): string[] {
  const inheritedDeployment = baseEnv.CONVEX_DEPLOYMENT;
  const deploymentConflicts =
    inheritedDeployment && inheritedDeployment !== configuredDeployment
      ? ['CONVEX_DEPLOYMENT']
      : [];
  const selectorConflicts = DEPLOYMENT_SELECTOR_ENV_NAMES.filter((name) => Boolean(baseEnv[name]));
  return [...deploymentConflicts, ...selectorConflicts];
}

/**
 * Build the environment for a `convex` child process.
 *
 * - A local Convex backend refuses to start when TZ is set to a non-UTC zone
 *   ("TZ is set, but Convex requires UTC"). Local deployments therefore never
 *   receive TZ.
 * - When `configuredDeployment` is given (the value from
 *   services/backend/.env.local), CONVEX_DEPLOYMENT is always set to it, so an
 *   inherited value cannot redirect the child, and deploy keys and self-hosted
 *   selectors inherited from the shell are removed.
 * - `scripts/convex-codegen.ts` does not target a specific deployment and omits
 *   the argument; inherited selectors are then left untouched.
 *
 * Returns a new object; the input is not mutated.
 */
export function buildConvexDevEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  localDeployment: boolean,
  configuredDeployment?: string
): Record<string, string | undefined> {
  const env = { ...baseEnv };
  if (localDeployment) {
    delete env.TZ;
  }
  if (configuredDeployment !== undefined) {
    for (const name of DEPLOYMENT_SELECTOR_ENV_NAMES) {
      delete env[name];
    }
    env.CONVEX_DEPLOYMENT = configuredDeployment;
  }
  return env;
}
