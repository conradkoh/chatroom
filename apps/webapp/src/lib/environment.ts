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

const DEFAULT_LOCAL_MANAGER_PORT = 3847;

/** Parsed local manager port, or null if not in local environment / invalid. */
export function getLocalManagerPort(): number | null {
  if (!isLocalEnvironment()) return null;
  const raw = process.env.NEXT_PUBLIC_LOCAL_MANAGER_PORT;
  const port = raw ? Number.parseInt(raw, 10) : DEFAULT_LOCAL_MANAGER_PORT;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return port;
}

/** Full URL to the Chatroom Local Manager UI, or null when unavailable. */
export function getLocalManagerUrl(): string | null {
  const port = getLocalManagerPort();
  return port === null ? null : `http://localhost:${port}`;
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
