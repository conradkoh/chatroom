/**
 * Prompt configuration entry point
 *
 * Provides centralized access to all prompt-related configuration.
 */

/**
 * Production Convex URL configuration
 */
const PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

/**
 * Prompt configuration interface
 */
export interface PromptConfig {
  /**
   * Get the production Convex URL
   */
  getConvexURL(): string;

  /**
   * Get convexUrl with production fallback
   * @param convexUrl - Optional Convex URL, falls back to production if not provided
   */
  getConvexURLWithFallback(convexUrl: string | undefined): string;

  /**
   * Check if a Convex URL is the production URL
   * @param convexUrl - Optional Convex URL to check
   */
  isProductionConvexURL(convexUrl: string | undefined): boolean;

  /**
   * Get CLI environment variable prefix for non-production environments
   * @param convexUrl - Optional Convex URL, returns empty string for production
   */
  getCliEnvPrefix(convexUrl: string | undefined): string;
}

/**
 * Implementation of prompt configuration
 */
class PromptConfigImpl implements PromptConfig {
  getConvexURL(): string {
    return PRODUCTION_CONVEX_URL;
  }

  getConvexURLWithFallback(convexUrl: string | undefined): string {
    return convexUrl || PRODUCTION_CONVEX_URL;
  }

  isProductionConvexURL(convexUrl: string | undefined): boolean {
    if (!convexUrl) return true; // Assume production if not specified
    return convexUrl === PRODUCTION_CONVEX_URL;
  }

  getCliEnvPrefix(convexUrl: string | undefined): string {
    if (this.isProductionConvexURL(convexUrl)) {
      return '';
    }
    return `CHATROOM_CONVEX_URL=${convexUrl} `;
  }
}

/**
 * Singleton instance of prompt configuration
 */
const configInstance = new PromptConfigImpl();

/**
 * Get the prompt configuration instance
 *
 * @example
 * import { getConfig } from './prompts/config/index.js';
 *
 * const config = getConfig();
 * const convexURL = config.getConvexURL();
 * const urlWithFallback = config.getConvexURLWithFallback(args.convexUrl);
 */
export function getConfig(): PromptConfig {
  return configInstance;
}

// Export convenience constants for backward compatibility
export const PRODUCTION_CONVEX_URL_CONST = PRODUCTION_CONVEX_URL;
