/**
 * Auth status command
 * Shows current authentication status
 */

import { api, type SessionValidation } from '../api.js';
import { loadAuthData, getAuthFilePath, isAuthenticated } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

export async function authStatus(): Promise<void> {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🔐 AUTHENTICATION STATUS`);
  console.log(`${'═'.repeat(50)}`);

  const authData = loadAuthData();

  if (!isAuthenticated() || !authData) {
    console.log(`\n❌ Not authenticated`);
    console.log(`\n   Run: chatroom auth login`);
    return;
  }

  console.log(`\n📁 Auth file: ${getAuthFilePath()}`);
  console.log(`📅 Created: ${authData.createdAt}`);
  if (authData.deviceName) {
    console.log(`💻 Device: ${authData.deviceName}`);
  }
  if (authData.cliVersion) {
    console.log(`📦 CLI Version: ${authData.cliVersion}`);
  }

  // Validate session with backend
  console.log(`\n⏳ Validating session...`);

  try {
    const client = await getConvexClient();
    const validation = (await client.query(api.cliAuth.validateSession, {
      sessionId: authData.sessionId,
    })) as SessionValidation;

    if (validation.valid) {
      console.log(`\n✅ Session is valid`);
      if (validation.userName) {
        console.log(`👤 User: ${validation.userName}`);
      }
    } else {
      console.log(`\n❌ Session is invalid: ${validation.reason}`);
      console.log(`\n   Run: chatroom auth login`);
    }
  } catch (error) {
    const err = error as Error;
    console.log(`\n⚠️  Could not validate session: ${err.message}`);
    console.log(`   Session may still be valid. Try running a command.`);
  }
}
