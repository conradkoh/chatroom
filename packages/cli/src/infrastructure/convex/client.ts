import { ConvexHttpClient } from 'convex/browser';

/**
 * The hardcoded Convex URL for the chatroom cloud service.
 * This is the only supported endpoint for the CLI.
 */
export const CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

let client: ConvexHttpClient | null = null;

/**
 * Get a singleton Convex HTTP client instance.
 * The client is lazily initialized on first use.
 */
export async function getConvexClient(): Promise<ConvexHttpClient> {
  if (!client) {
    client = new ConvexHttpClient(CONVEX_URL);
  }
  return client;
}

/**
 * Get the Convex URL (for logging/display purposes)
 */
export function getConvexUrl(): string {
  return CONVEX_URL;
}

/**
 * Reset the client (useful for testing or reconnection)
 */
export function resetConvexClient(): void {
  client = null;
}
