import { ConvexHttpClient, ConvexClient } from 'convex/browser';

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

/**
 * Check if Convex client logging should be enabled.
 * Defaults to false to keep CLI output clean.
 * Set CHATROOM_ENABLE_CLIENT_LOGGING=true to enable backend logs streaming to CLI.
 */
export function isClientLoggingEnabled(): boolean {
  return process.env.CHATROOM_ENABLE_CLIENT_LOGGING === 'true';
}

// For backwards compatibility - use getConvexUrl() instead
export const CONVEX_URL = DEFAULT_CONVEX_URL;

let client: ConvexHttpClient | null = null;
let wsClient: ConvexClient | null = null;
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
    const enableLogging = isClientLoggingEnabled();
    client = new ConvexHttpClient(url, {
      logger: enableLogging,
    });
  }
  return client;
}

/**
 * Get a singleton Convex WebSocket client instance.
 * This client supports real-time subscriptions via onUpdate.
 * The client is lazily initialized on first use.
 */
export async function getConvexWsClient(): Promise<ConvexClient> {
  const url = getConvexUrl();

  // Reset client if URL has changed
  if (wsClient && cachedUrl !== url) {
    await wsClient.close();
    wsClient = null;
  }

  if (!wsClient) {
    cachedUrl = url;
    const enableLogging = isClientLoggingEnabled();
    wsClient = new ConvexClient(url, {
      logger: enableLogging,
    });
  }
  return wsClient;
}

/**
 * Reset the client (useful for testing or reconnection)
 */
export function resetConvexClient(): void {
  client = null;
  if (wsClient) {
    wsClient.close();
    wsClient = null;
  }
  cachedUrl = null;
}
