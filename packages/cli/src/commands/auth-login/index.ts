/**
 * Auth login command
 * Implements device authorization flow for CLI authentication
 */

import type { SessionId } from 'convex-helpers/server/sessions';

import type { AuthLoginDeps } from './deps.js';
import { api } from '../../api.js';
import {
  saveAuthData,
  getDeviceName,
  getCliVersion,
  isAuthenticated,
  getAuthFilePath,
} from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';

// Poll interval for checking auth status
const AUTH_POLL_INTERVAL_MS = 2000;

// Production URLs
const PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';
const PRODUCTION_WEBAPP_URL = 'https://chatroom.duskfare.com';

interface AuthLoginOptions {
  force?: boolean;
}

/**
 * Open URL in the default browser (production implementation)
 */
async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    } else if (platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      // Linux and others
      const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    }
  } catch {
    // If opening browser fails, user can manually visit the URL
    console.log(`\n⚠️  Could not open browser automatically.`);
    console.log(`   Please visit the URL manually.`);
  }
}

/**
 * Create the default production dependencies.
 */
export function createDefaultDeps(): AuthLoginDeps {
  return {
    backend: {
      mutation: async (endpoint, args) => {
        const client = await getConvexClient();
        return client.mutation(endpoint, args);
      },
      query: async (endpoint, args) => {
        const client = await getConvexClient();
        return client.query(endpoint, args);
      },
    },
    auth: {
      isAuthenticated,
      getAuthFilePath,
      saveAuthData,
      getDeviceName,
      getCliVersion,
    },
    browser: {
      open: openBrowser,
    },
    clock: {
      now: () => Date.now(),
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    process: {
      env: process.env as Record<string, string | undefined>,
      platform: process.platform,
      exit: (code) => process.exit(code),
      stdoutWrite: (text) => process.stdout.write(text),
    },
  };
}

/**
 * Get the webapp URL for the auth page.
 *
 * For production Convex URL, uses production webapp.
 * For non-production Convex URL, requires CHATROOM_WEB_URL to be set explicitly.
 */
export function getWebAppUrl(d: AuthLoginDeps): string {
  const convexUrl = getConvexUrl();

  // Production Convex → Production webapp
  if (convexUrl === PRODUCTION_CONVEX_URL) {
    return PRODUCTION_WEBAPP_URL;
  }

  // Non-production: require explicit CHATROOM_WEB_URL
  const webAppUrlOverride = d.process.env.CHATROOM_WEB_URL;
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
  d.process.exit(1);
  return ''; // unreachable in production, needed for type safety in tests
}

export async function authLogin(options: AuthLoginOptions, deps?: AuthLoginDeps): Promise<void> {
  const d = deps ?? createDefaultDeps();

  // Check if already authenticated
  if (d.auth.isAuthenticated() && !options.force) {
    console.log(`✅ Already authenticated.`);
    console.log(`   Auth file: ${d.auth.getAuthFilePath()}`);
    console.log(`\n   Use --force to re-authenticate.`);
    return;
  }

  // Get device info
  const deviceName = d.auth.getDeviceName();
  const cliVersion = d.auth.getCliVersion();

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

  const result = await d.backend.mutation(api.cliAuth.createAuthRequest, {
    deviceName,
    cliVersion,
  });

  const { requestId, expiresAt } = result;
  const expiresInSeconds = Math.round((expiresAt - d.clock.now()) / 1000);

  console.log(`\n✅ Auth request created`);
  console.log(`   Request ID: ${requestId.substring(0, 8)}...`);
  console.log(`   Expires in: ${expiresInSeconds} seconds`);

  // Get the webapp URL (reads from .env.local PORT or uses defaults)
  const webAppUrl = getWebAppUrl(d);

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
  await d.browser.open(authUrl);

  // Poll for approval
  console.log(`\n⏳ Waiting for authorization...`);
  console.log(`   (Press Ctrl+C to cancel)\n`);

  let pollCount = 0;
  const maxPolls = Math.ceil((expiresAt - d.clock.now()) / AUTH_POLL_INTERVAL_MS);

  // Poll result: 'continue' to keep polling, 'done' to stop successfully,
  // 'exit' to stop due to denial/expiry/error-exit.
  type PollResult = 'continue' | 'done' | 'exit';

  const poll = async (): Promise<PollResult> => {
    pollCount++;

    try {
      const status = await d.backend.query(api.cliAuth.getAuthRequestStatus, {
        requestId,
      });

      if (status.status === 'approved' && status.sessionId) {
        // Success! Save the session
        d.auth.saveAuthData({
          sessionId: status.sessionId as SessionId,
          createdAt: new Date().toISOString(),
          deviceName,
          cliVersion,
        });

        console.log(`\n${'═'.repeat(50)}`);
        console.log(`✅ AUTHENTICATION SUCCESSFUL`);
        console.log(`${'═'.repeat(50)}`);
        console.log(`\nSession stored at: ${d.auth.getAuthFilePath()}`);
        console.log(`\nYou can now use chatroom commands.`);
        return 'done';
      }

      if (status.status === 'denied') {
        console.log(`\n❌ Authorization denied by user.`);
        d.process.exit(1);
        return 'exit';
      }

      if (status.status === 'expired' || status.status === 'not_found') {
        console.log(`\n❌ Authorization request expired.`);
        console.log(`   Please try again: chatroom auth login`);
        d.process.exit(1);
        return 'exit';
      }

      // Still pending
      if (pollCount % 5 === 0) {
        const remainingSeconds = Math.round((expiresAt - d.clock.now()) / 1000);
        d.process.stdoutWrite(`\r   Waiting... (${remainingSeconds}s remaining)   `);
      }

      if (pollCount >= maxPolls) {
        console.log(`\n❌ Authorization request expired.`);
        console.log(`   Please try again: chatroom auth login`);
        d.process.exit(1);
        return 'exit';
      }

      return 'continue';
    } catch (error) {
      const err = error as Error;
      console.error(`\n⚠️  Error polling for authorization: ${err.message}`);
      return 'continue';
    }
  };

  // Start polling loop
  while (true) {
    const result = await poll();
    if (result === 'done' || result === 'exit') break;
    await d.clock.delay(AUTH_POLL_INTERVAL_MS);
  }
}
