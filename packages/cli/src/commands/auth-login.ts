/**
 * Auth login command
 * Implements device authorization flow for CLI authentication
 */

import { api, type AuthRequestResult, type AuthRequestStatus } from '../api.js';
import { loadConfig } from '../config/loader.js';
import {
  saveAuthData,
  getDeviceName,
  getCliVersion,
  isAuthenticated,
  getAuthFilePath,
} from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

// Poll interval for checking auth status
const AUTH_POLL_INTERVAL_MS = 2000;

interface AuthLoginOptions {
  force?: boolean;
}

/**
 * Get the webapp URL for the auth page
 * Priority order:
 * 1. CHATROOM_WEB_URL environment variable (highest priority)
 * 2. webappUrl from ~/.chatroom/chatroom.jsonc config
 * 3. Falls back to http://localhost:3000
 */
function getWebAppUrl(): string {
  // 1. Check environment variable override
  const webAppUrlOverride = process.env.CHATROOM_WEB_URL;
  if (webAppUrlOverride) {
    return webAppUrlOverride;
  }

  // 2. Check config file
  try {
    const config = loadConfig();
    if (config?.config?.webappUrl) {
      return config.config.webappUrl;
    }
  } catch {
    // Config not found or invalid, continue to default
  }

  // 3. Default to standard Next.js dev port
  return 'http://localhost:3000';
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

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🔐 CHATROOM CLI AUTHENTICATION`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`\nDevice: ${deviceName}`);
  console.log(`CLI Version: ${cliVersion}`);

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
          sessionId: status.sessionId,
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
