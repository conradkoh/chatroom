/**
 * Environment detection utilities.
 * Uses URL comparison to determine local vs production environments.
 */

/**
 * The production Convex URL.
 * When NEXT_PUBLIC_CONVEX_URL differs from this, we're in a local/dev environment.
 */
const PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

/**
 * Check if the current environment is local (non-production).
 * Returns true if NEXT_PUBLIC_CONVEX_URL is set and differs from production URL.
 */
export function isLocalEnvironment(): boolean {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  // If no URL configured, assume production
  if (!convexUrl) return false;

  // Local if URL differs from production
  return convexUrl !== PRODUCTION_CONVEX_URL;
}

/**
 * Get the app title with optional (Local) suffix for non-production environments.
 */
export function getAppTitle(baseTitle = 'Chatroom'): string {
  return isLocalEnvironment() ? `${baseTitle} (Local)` : baseTitle;
}

/** Returns the chatroom daemon start command with env vars for this environment. */
export function getDaemonStartCommand(): string {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl || convexUrl === PRODUCTION_CONVEX_URL) {
    return 'chatroom machine daemon start';
  }
  return `CHATROOM_CONVEX_URL=${convexUrl} chatroom machine daemon start`;
}

/**
 * Returns the chatroom auth login command with env vars for this environment.
 * @param webUrl - The web URL (window.location.origin). Required in local/dev environments.
 */
export function getAuthLoginCommand(webUrl: string): string {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl || convexUrl === PRODUCTION_CONVEX_URL) {
    return 'chatroom auth login';
  }
  // Local environment — webUrl is required
  if (!webUrl) {
    throw new Error(
      'getAuthLoginCommand: webUrl is required in local/dev environments. ' +
        'Pass window.location.origin from a client component.'
    );
  }
  return `CHATROOM_WEB_URL=${webUrl} \\\nCHATROOM_CONVEX_URL=${convexUrl} \\\nchatroom auth login`;
}
