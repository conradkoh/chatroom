/**
 * Register agent type for a chatroom role.
 *
 * Must be called as the agent's first action before get-next-task.
 * Registers the agent as either "remote" (daemon-managed) or "custom" (manually started)
 * in the team agent config on the backend.
 */

import type { RegisterAgentDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import { ensureMachineRegistered } from '../../infrastructure/machine/index.js';
import { OpenCodeAgentService } from '../../infrastructure/services/remote-agents/opencode/index.js';
import { PiAgentService } from '../../infrastructure/services/remote-agents/pi/index.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { RegisterAgentDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RegisterAgentOptions {
  role: string;
  type: 'remote' | 'custom';
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<RegisterAgentDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

// ─── Entry Point ───────────────────────────────────────────────────────────

export async function registerAgent(
  chatroomId: string,
  options: RegisterAgentOptions,
  deps?: RegisterAgentDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { role, type } = options;

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    const otherUrls = d.session.getOtherSessionUrls();
    const currentUrl = d.session.getConvexUrl();

    console.error(`❌ Not authenticated for: ${currentUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom register-agent ...`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }

    console.error(`   chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  if (!/^[a-zA-Z0-9_]+$/.test(chatroomId)) {
    console.error(
      `❌ Invalid chatroom ID format: ID must contain only alphanumeric characters and underscores`
    );
    process.exit(1);
  }

  // Validate chatroom exists and user has access
  const chatroom = await d.backend.query(api.chatrooms.get, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  if (!chatroom) {
    console.error(`❌ Chatroom ${chatroomId} not found or access denied`);
    process.exit(1);
  }

  if (type === 'remote') {
    // Remote type: register machine only.
    // NOTE: saveTeamAgentConfig is intentionally NOT called here.
    // The team agent config (harness, model, workingDir) is owned exclusively
    // by start-agent (the UI "Start Agent" button). Calling saveTeamAgentConfig
    // here would write stale/incomplete config before the user has configured
    // the agent via the UI, violating the invariant that config is only set
    // when the user explicitly starts the agent.
    try {
      const machineInfo = ensureMachineRegistered();

      // Discover available models from all installed harnesses (non-critical)
      const availableModels: Record<string, string[]> = {};
      try {
        const opencodeService = new OpenCodeAgentService();
        if (opencodeService.isInstalled()) {
          availableModels['opencode'] = await opencodeService.listModels();
        }
      } catch {
        /* non-critical */
      }
      try {
        const piService = new PiAgentService();
        if (piService.isInstalled()) {
          availableModels['pi'] = await piService.listModels();
        }
      } catch {
        /* non-critical */
      }

      // Register/update machine in backend (machine identity + capabilities only)
      await d.backend.mutation(api.machines.register, {
        sessionId,
        machineId: machineInfo.machineId,
        hostname: machineInfo.hostname,
        os: machineInfo.os,
        availableHarnesses: machineInfo.availableHarnesses,
        harnessVersions: machineInfo.harnessVersions,
        availableModels,
      });

      // Emit agent.registered event so the frontend shows this agent as online
      try {
        await d.backend.mutation(api.machines.recordAgentRegistered, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          agentType: 'remote',
          machineId: machineInfo.machineId,
        });
      } catch {
        // Non-critical — agent will still show as online once get-next-task starts
      }

      console.log(`✅ Registered as remote agent for role "${role}"`);
      console.log(`   Machine: ${machineInfo.hostname} (${machineInfo.machineId})`);
      console.log(`   Working directory: ${process.cwd()}`);
    } catch (error) {
      console.error(`❌ Registration failed: ${(error as Error).message}`);
      process.exit(1);
    }
  } else {
    // Custom type: register without machine details
    try {
      await d.backend.mutation(api.machines.saveTeamAgentConfig, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
        type: 'custom',
      });

      console.log(`✅ Registered as custom agent for role "${role}"`);
    } catch (error) {
      console.error(`❌ Registration failed: ${(error as Error).message}`);
      process.exit(1);
    }
  }
}
