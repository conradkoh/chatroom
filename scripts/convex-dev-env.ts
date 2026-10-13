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
