/**
 * Environment utilities for generating CLI command prefixes
 *
 * Re-exports from config layer for backward compatibility.
 * Prefer importing from '../config/index.js' directly.
 */

import { getConfig } from '../config/index.js';

const config = getConfig();

/**
 * The default production Convex URL.
 * CLI commands should not include env var prefix when using this URL.
 */
export const PRODUCTION_CONVEX_URL = config.getConvexURL();

/**
 * Check if a Convex URL is the production URL.
 * Returns false for any non-production URL (local dev, preview, etc.)
 */
export function isProductionConvexUrl(convexUrl: string | undefined): boolean {
  return config.isProductionConvexURL(convexUrl);
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
  return config.getCliEnvPrefix(convexUrl);
}

/**
 * Get convexUrl with production fallback.
 * Returns the provided URL or defaults to production URL if not provided.
 *
 * @example
 * getConvexUrlWithFallback('http://127.0.0.1:3210')
 * // → 'http://127.0.0.1:3210'
 *
 * @example
 * getConvexUrlWithFallback(undefined)
 * // → 'https://chatroom-cloud.duskfare.com'
 */
export function getConvexUrlWithFallback(convexUrl: string | undefined): string {
  return config.getConvexURLWithFallback(convexUrl);
}
