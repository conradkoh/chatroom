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

export function applyConvexDevEnvDefaults(): void {
  for (const [key, value] of Object.entries(CONVEX_DEV_ENV_DEFAULTS)) {
    process.env[key] ??= value;
  }
}

/**
 * Build the environment for a `convex` child process.
 *
 * A local Convex backend refuses to start when TZ is set to a non-UTC zone
 * ("TZ is set, but Convex requires UTC"). Local deployments therefore never
 * receive TZ. Hosted launches keep the environment as-is. Returns a new object;
 * the input is not mutated.
 */
export function buildConvexDevEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  localDeployment: boolean
): Record<string, string | undefined> {
  const env = { ...baseEnv };
  if (localDeployment) {
    delete env.TZ;
  }
  return env;
}
