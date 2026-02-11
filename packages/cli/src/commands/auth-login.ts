/**
 * Auth login command
 * Implements device authorization flow for CLI authentication
 */

import type { SessionId } from 'convex-helpers/server/sessions';

import { api, type AuthRequestResult, type AuthRequestStatus } from '../api.js';
import {
  saveAuthData,
  getDeviceName,
  getCliVersion,
  isAuthenticated,
  getAuthFilePath,
} from '../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../infrastructure/convex/client.js';

// Poll interval for checking auth status
const AUTH_POLL_INTERVAL_MS = 2000;

// Production URLs
const PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';
const PRODUCTION_WEBAPP_URL = 'https://chatroom.duskfare.com';

interface AuthLoginOptions {
  force?: boolean;
}

/**
 * Get the webapp URL for the auth page
 *
 * For production Convex URL, uses production webapp.
 * For non-production Convex URL, requires CHATROOM_WEB_URL to be set explicitly.
 */
function getWebAppUrl(): string {
  const convexUrl = getConvexUrl();

  // Production Convex → Production webapp
  if (convexUrl === PRODUCTION_CONVEX_URL) {
    return PRODUCTION_WEBAPP_URL;
  }

  // Non-production: require explicit CHATROOM_WEB_URL
  const webAppUrlOverride = process.env.CHATROOM_WEB_URL;
  if (webAppUrlOverride) {
    return webAppUrlOverride;
  }

  // Error: non-production Convex URL without CHATROOM_WEB_URL
  console.error(`\n${'═'.repeat(50)}`);
  console.error(`❌ CHATROOM_WEB_URL Required`);
  console.error(`${'═'.repeat(50)}`);
  console.error(`\nYou are using a non-production Convex backend:`);
  console.error(`   CHATROOM_CONVEX_URL=${convexUrl}`);
  console.error(`\nTo authenticate with a local/dev backend, you must also set`);
  console.error(`the webapp URL where the auth page is hosted:`);
  console.error(`\n   CHATROOM_WEB_URL=http://localhost:3000 \\`);
  console.error(`   CHATROOM_CONVEX_URL=${convexUrl} \\`);
  console.error(`   chatroom auth login`);
  console.error(`\n${'═'.repeat(50)}\n`);
  process.exit(1);
}

/**
 * Open URL in the default browser
 */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      await execAsync(`open "${url}"`);
    } else if (platform === 'win32') {
      await execAsync(`start "" "${url}"`);
    } else {
      // Linux and others
      await execAsync(`xdg-open "${url}"`);
    }
  } catch {
    // If opening browser fails, user can manually visit the URL
    console.log(`\n⚠️  Could not open browser automatically.`);
    console.log(`   Please visit the URL manually.`);
  }
}

export async function authLogin(options: AuthLoginOptions): Promise<void> {
  // Check if already authenticated
  if (isAuthenticated() && !options.force) {
    console.log(`✅ Already authenticated.`);
    console.log(`   Auth file: ${getAuthFilePath()}`);
    console.log(`\n   Use --force to re-authenticate.`);
    return;
  }

  const client = await getConvexClient();

  // Get device info
  const deviceName = getDeviceName();
  const cliVersion = getCliVersion();

  // Get the Convex URL being used
  const convexUrl = getConvexUrl();

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🔐 CHATROOM CLI AUTHENTICATION`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`\nDevice: ${deviceName}`);
  console.log(`CLI Version: ${cliVersion}`);

  // Show environment info for non-production
  if (convexUrl !== PRODUCTION_CONVEX_URL) {
    console.log(`\n📍 Environment: Custom`);
    console.log(`   Convex URL: ${convexUrl}`);
  }

  // Create auth request
  console.log(`\n⏳ Creating authentication request...`);

  const result = (await client.mutation(api.cliAuth.createAuthRequest, {
    deviceName,
    cliVersion,
  })) as AuthRequestResult;

  const { requestId, expiresAt } = result;
  const expiresInSeconds = Math.round((expiresAt - Date.now()) / 1000);

  console.log(`\n✅ Auth request created`);
  console.log(`   Request ID: ${requestId.substring(0, 8)}...`);
  console.log(`   Expires in: ${expiresInSeconds} seconds`);

  // Get the webapp URL (reads from .env.local PORT or uses defaults)
  const webAppUrl = getWebAppUrl();

  // The auth page should be at /cli-auth
  const authUrl = `${webAppUrl}/cli-auth?request=${requestId}`;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📱 AUTHORIZATION REQUIRED`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`\nOpening browser for authorization...`);
  console.log(`\nIf the browser doesn't open, visit this URL:`);
  console.log(`\n  ${authUrl}`);
  console.log(`\n${'─'.repeat(50)}`);

  // Open browser
  await openBrowser(authUrl);

  // Poll for approval
  console.log(`\n⏳ Waiting for authorization...`);
  console.log(`   (Press Ctrl+C to cancel)\n`);

  let pollCount = 0;
  const maxPolls = Math.ceil((expiresAt - Date.now()) / AUTH_POLL_INTERVAL_MS);

  const poll = async (): Promise<boolean> => {
    pollCount++;

    try {
      const status = (await client.query(api.cliAuth.getAuthRequestStatus, {
        requestId,
      })) as AuthRequestStatus;

      if (status.status === 'approved' && status.sessionId) {
        // Success! Save the session
        saveAuthData({
          sessionId: status.sessionId as SessionId,
          createdAt: new Date().toISOString(),
          deviceName,
          cliVersion,
        });

        console.log(`\n${'═'.repeat(50)}`);
        console.log(`✅ AUTHENTICATION SUCCESSFUL`);
        console.log(`${'═'.repeat(50)}`);
        console.log(`\nSession stored at: ${getAuthFilePath()}`);
        console.log(`\nYou can now use chatroom commands.`);
        return true;
      }

      if (status.status === 'denied') {
        console.log(`\n❌ Authorization denied by user.`);
        process.exit(1);
      }

      if (status.status === 'expired' || status.status === 'not_found') {
        console.log(`\n❌ Authorization request expired.`);
        console.log(`   Please try again: chatroom auth login`);
        process.exit(1);
      }

      // Still pending
      if (pollCount % 5 === 0) {
        const remainingSeconds = Math.round((expiresAt - Date.now()) / 1000);
        process.stdout.write(`\r   Waiting... (${remainingSeconds}s remaining)   `);
      }

      if (pollCount >= maxPolls) {
        console.log(`\n❌ Authorization request expired.`);
        console.log(`   Please try again: chatroom auth login`);
        process.exit(1);
      }

      return false;
    } catch (error) {
      const err = error as Error;
      console.error(`\n⚠️  Error polling for authorization: ${err.message}`);
      return false;
    }
  };

  // Start polling loop
  while (true) {
    const success = await poll();
    if (success) break;
    await new Promise((resolve) => setTimeout(resolve, AUTH_POLL_INTERVAL_MS));
  }
}
