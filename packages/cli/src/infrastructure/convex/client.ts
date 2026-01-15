import { ConvexHttpClient } from 'convex/browser';

/**
 * The default Convex URL for the chatroom cloud service.
 * Can be overridden with the CHATROOM_CONVEX_URL environment variable.
 */
const DEFAULT_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

/**
 * Get the Convex URL, checking for environment variable override.
 */
export function getConvexUrl(): string {
  return process.env.CHATROOM_CONVEX_URL || DEFAULT_CONVEX_URL;
}

// For backwards compatibility - use getConvexUrl() instead
export const CONVEX_URL = DEFAULT_CONVEX_URL;

let client: ConvexHttpClient | null = null;
let cachedUrl: string | null = null;

/**
 * Get a singleton Convex HTTP client instance.
 * The client is lazily initialized on first use.
 */
export async function getConvexClient(): Promise<ConvexHttpClient> {
  const url = getConvexUrl();

  // Reset client if URL has changed
  if (client && cachedUrl !== url) {
    client = null;
  }

  if (!client) {
    cachedUrl = url;
    client = new ConvexHttpClient(url);
  }
  return client;
}

/**
 * Reset the client (useful for testing or reconnection)
 */
export function resetConvexClient(): void {
  client = null;
  cachedUrl = null;
}
