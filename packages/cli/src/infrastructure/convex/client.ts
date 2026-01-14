import { ConvexHttpClient } from 'convex/browser';

import { findConfigPath, loadConfigFromPath, getGlobalConfigPath } from '../../config/loader.js';

let client: ConvexHttpClient | null = null;
let cachedConvexUrl: string | null = null;

/**
 * Get the Convex URL from the nearest config file
 */
function resolveConvexUrl(): string {
  const configPath = findConfigPath();

  if (!configPath) {
    console.error('❌ No chatroom configuration found');
    console.error('');
    console.error("Please run 'chatroom init' to set up your configuration,");
    console.error('or create a config file at: ' + getGlobalConfigPath());
    process.exit(1);
  }

  const config = loadConfigFromPath(configPath);

  if (!config.convexUrl) {
    console.error('❌ No convexUrl found in configuration');
    console.error(`   Config file: ${configPath}`);
    console.error('');
    console.error('Please add "convexUrl" to your config file.');
    process.exit(1);
  }

  return config.convexUrl;
}

/**
 * Get a singleton Convex HTTP client instance.
 * The client is lazily initialized on first use.
 */
export async function getConvexClient(): Promise<ConvexHttpClient> {
  if (!client) {
    cachedConvexUrl = resolveConvexUrl();
    client = new ConvexHttpClient(cachedConvexUrl);
  }
  return client;
}

/**
 * Get the current Convex URL (for logging/display purposes)
 * Returns null if client hasn't been initialized yet
 */
export function getCurrentConvexUrl(): string | null {
  return cachedConvexUrl;
}

/**
 * Reset the client (useful for testing or reconnection)
 */
export function resetConvexClient(): void {
  client = null;
  cachedConvexUrl = null;
}
