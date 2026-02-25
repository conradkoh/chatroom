/**
 * Auth status command
 * Shows current authentication status and registers machine
 */

import type { AuthStatusDeps } from './deps.js';
import { api } from '../../api.js';
import {
  loadAuthData,
  getAuthFilePath,
  isAuthenticated,
} from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';
import { ensureMachineRegistered } from '../../infrastructure/machine/index.js';
import { getVersion } from '../../version.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { AuthStatusDeps } from './deps.js';

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function listAvailableModelsDefault(): Promise<Record<string, string[]>> {
  const results: Record<string, string[]> = {};
  try {
    const { OpenCodeAgentService } =
      await import('../../infrastructure/services/remote-agents/opencode/index.js');
    const agentService = new OpenCodeAgentService();
    if (agentService.isInstalled()) {
      results['opencode'] = await agentService.listModels();
    }
  } catch {
    /* non-critical */
  }
  try {
    const { PiAgentService } =
      await import('../../infrastructure/services/remote-agents/pi/index.js');
    const piService = new PiAgentService();
    if (piService.isInstalled()) {
      results['pi'] = await piService.listModels();
    }
  } catch {
    /* non-critical */
  }
  return results;
}

async function createDefaultDeps(): Promise<AuthStatusDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      loadAuthData,
      getAuthFilePath,
      isAuthenticated,
    },
    getVersion,
    ensureMachineRegistered,
    listAvailableModels: listAvailableModelsDefault,
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

      // Register machine with backend (idempotent)
      try {
        const machineInfo = d.ensureMachineRegistered();
        const availableModels = await d.listAvailableModels();

        await d.backend.mutation(api.machines.register, {
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
        const totalModels = Object.values(availableModels).flat().length;
        if (totalModels > 0) {
          console.log(`   Models: ${totalModels} discovered`);
        }
      } catch (machineError) {
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
