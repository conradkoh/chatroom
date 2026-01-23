/**
 * Environment utilities for generating CLI command prefixes
 */

/**
 * The default production Convex URL.
 * CLI commands should not include env var prefix when using this URL.
 */
const PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

/**
 * Check if a Convex URL is the production URL.
 * Returns false for any non-production URL (local dev, preview, etc.)
 */
export function isProductionConvexUrl(convexUrl: string | undefined): boolean {
  if (!convexUrl) return true; // Assume production if not specified
  return convexUrl === PRODUCTION_CONVEX_URL;
}

/**
 * Get the CLI command prefix for non-production environments.
 * Returns empty string for production, otherwise returns the env var override.
 *
 * @example
 * getCliEnvPrefix('http://127.0.0.1:3210')
 * // → 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 '
 *
 * @example
 * getCliEnvPrefix('https://chatroom-cloud.duskfare.com')
 * // → ''
 */
export function getCliEnvPrefix(convexUrl: string | undefined): string {
  if (isProductionConvexUrl(convexUrl)) {
    return '';
  }
  return `CHATROOM_CONVEX_URL=${convexUrl} `;
}
