/**
 * Auth status command
 * Shows current authentication status and registers machine
 */

import { api, type SessionValidation } from '../api.js';
import { loadAuthData, getAuthFilePath, isAuthenticated } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';
import { ensureMachineRegistered } from '../infrastructure/machine/index.js';
import { getVersion } from '../version.js';

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
  // Always show current CLI version, not the version saved at login time
  console.log(`📦 CLI Version: ${getVersion()}`);

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

      // Register machine with backend (idempotent)
      // This ensures the daemon can find and use this machine
      try {
        const machineInfo = ensureMachineRegistered();

        // Discover available models from installed harnesses
        let availableModels: string[] = [];
        try {
          const { getDriverRegistry } = await import('../infrastructure/agent-drivers/index.js');
          const registry = getDriverRegistry();
          for (const driver of registry.all()) {
            if (driver.capabilities.dynamicModelDiscovery) {
              const models = await driver.listModels();
              availableModels = availableModels.concat(models);
            }
          }
        } catch {
          // Model discovery is non-critical — continue with empty list
        }

        await client.mutation(api.machines.register, {
          sessionId: authData.sessionId,
          machineId: machineInfo.machineId,
          hostname: machineInfo.hostname,
          os: machineInfo.os,
          availableHarnesses: machineInfo.availableHarnesses,
          harnessVersions: machineInfo.harnessVersions,
          availableModels,
        });

        console.log(`\n🖥️  Machine registered: ${machineInfo.hostname}`);
        console.log(`   ID: ${machineInfo.machineId}`);
        if (machineInfo.availableHarnesses.length > 0) {
          console.log(`   Harnesses: ${machineInfo.availableHarnesses.join(', ')}`);
        }
        if (availableModels.length > 0) {
          console.log(`   Models: ${availableModels.length} discovered`);
        }
      } catch (machineError) {
        // Machine registration is non-critical — don't fail auth status
        const err = machineError as Error;
        console.log(`\n⚠️  Machine registration skipped: ${err.message}`);
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
