/**
 * Environment utilities for webapp prompts
 *
 * Re-exports from config layer to avoid duplication.
 * Uses the centralized configuration from prompts/config.
 */

import { getConfig } from '../../../config/index.js';

const config = getConfig();

/**
 * The default production Convex URL.
 */
export const PRODUCTION_CONVEX_URL = config.getConvexURL();

/**
 * Check if a Convex URL is the production URL.
 */
export function isProductionConvexUrl(convexUrl: string | undefined): boolean {
  return config.isProductionConvexURL(convexUrl);
}

/**
 * Get the CLI command prefix for non-production environments.
 */
export function getCliEnvPrefix(convexUrl: string | undefined): string {
  return config.getCliEnvPrefix(convexUrl);
}

/**
 * Get convexUrl with production fallback.
 */
export function getConvexUrlWithFallback(convexUrl: string | undefined): string {
  return config.getConvexURLWithFallback(convexUrl);
}
