/**
 * Register agent type for a chatroom role.
 *
 * Must be called as the agent's first action before wait-for-task.
 * Registers the agent as either "remote" (daemon-managed) or "custom" (manually started)
 * in the team agent config on the backend.
 */

import { api } from '../api.js';
import type { Id } from '../api.js';
import { getDriverRegistry } from '../infrastructure/agent-drivers/index.js';
import { getSessionId, getOtherSessionUrls } from '../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../infrastructure/convex/client.js';
import { ensureMachineRegistered, type AgentHarness } from '../infrastructure/machine/index.js';

interface RegisterAgentOptions {
  role: string;
  type: 'remote' | 'custom';
}

export async function registerAgent(
  chatroomId: string,
  options: RegisterAgentOptions
): Promise<void> {
  const client = await getConvexClient();
  const { role, type } = options;

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    const otherUrls = getOtherSessionUrls();
    const currentUrl = getConvexUrl();

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
  const chatroom = await client.query(api.chatrooms.get, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  if (!chatroom) {
    console.error(`❌ Chatroom ${chatroomId} not found or access denied`);
    process.exit(1);
  }

  if (type === 'remote') {
    // Remote type: register machine and include machine details
    try {
      const machineInfo = ensureMachineRegistered();

      // Discover available models from installed harnesses
      let availableModels: string[] = [];
      try {
        const registry = getDriverRegistry();
        for (const driver of registry.all()) {
          if (driver.capabilities.dynamicModelDiscovery) {
            const models = await driver.listModels();
            availableModels = availableModels.concat(models);
          }
        }
      } catch {
        // Model discovery is non-critical
      }

      // Register/update machine in backend
      await client.mutation(api.machines.register, {
        sessionId,
        machineId: machineInfo.machineId,
        hostname: machineInfo.hostname,
        os: machineInfo.os,
        availableHarnesses: machineInfo.availableHarnesses,
        harnessVersions: machineInfo.harnessVersions,
        availableModels,
      });

      // Determine agent harness (default to first available)
      const agentHarness: AgentHarness | undefined =
        machineInfo.availableHarnesses.length > 0 ? machineInfo.availableHarnesses[0] : undefined;

      // Save team agent config with machine details
      await client.mutation(api.machines.saveTeamAgentConfig, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
        type: 'remote',
        machineId: machineInfo.machineId,
        agentHarness,
        workingDir: process.cwd(),
      });

      console.log(`✅ Registered as remote agent for role "${role}"`);
      console.log(`   Machine: ${machineInfo.hostname} (${machineInfo.machineId})`);
      console.log(`   Working directory: ${process.cwd()}`);
      if (agentHarness) {
        console.log(`   Agent harness: ${agentHarness}`);
      }
    } catch (error) {
      console.error(`❌ Registration failed: ${(error as Error).message}`);
      process.exit(1);
    }
  } else {
    // Custom type: register without machine details
    try {
      await client.mutation(api.machines.saveTeamAgentConfig, {
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
