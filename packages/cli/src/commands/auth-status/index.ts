/**
 * Auth status command
 * Shows current authentication status and local machine info
 */

import type { AuthStatusDeps } from './deps.js';
import { api } from '../../api.js';
import {
  loadAuthData,
  getAuthFilePath,
  isAuthenticated,
} from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';
import { loadMachineConfig } from '../../infrastructure/machine/index.js';
import { getVersion } from '../../version.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { AuthStatusDeps } from './deps.js';

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<AuthStatusDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      loadAuthData,
      getAuthFilePath,
      isAuthenticated,
    },
    getVersion,
    loadMachineConfig,
  };
}

// ─── Entry Point ───────────────────────────────────────────────────────────

export async function authStatus(deps?: AuthStatusDeps): Promise<void> {
  const d = deps ?? (await createDefaultDeps());

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🔐 AUTHENTICATION STATUS`);
  console.log(`${'═'.repeat(50)}`);

  const authData = d.session.loadAuthData();

  if (!d.session.isAuthenticated() || !authData) {
    console.log(`\n❌ Not authenticated`);
    console.log(`\n   Run: chatroom auth login`);
    return;
  }

  console.log(`\n📁 Auth file: ${d.session.getAuthFilePath()}`);
  console.log(`📅 Created: ${authData.createdAt}`);
  if (authData.deviceName) {
    console.log(`💻 Device: ${authData.deviceName}`);
  }
  console.log(`📦 CLI Version: ${d.getVersion()}`);

  // Validate session with backend
  console.log(`\n⏳ Validating session...`);

  try {
    const validation = await d.backend.query(api.cliAuth.validateSession, {
      sessionId: authData.sessionId,
    });

    if (validation.valid) {
      console.log(`\n✅ Session is valid`);
      if (validation.userName) {
        console.log(`👤 User: ${validation.userName}`);
      }

      // Display local machine info (read-only — machine registration is owned by the daemon)
      const machineConfig = d.loadMachineConfig();
      if (machineConfig) {
        console.log(`\n🖥️  Machine: ${machineConfig.hostname}`);
        console.log(`   ID: ${machineConfig.machineId}`);
        if (machineConfig.availableHarnesses.length > 0) {
          console.log(`   Harnesses: ${machineConfig.availableHarnesses.join(', ')}`);
        }
      } else {
        console.log(`\n🖥️  Machine: not registered`);
        console.log(`   Run \`chatroom machine start\` to register this machine.`);
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
