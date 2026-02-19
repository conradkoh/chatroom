/**
 * Wait for Task Command — entry point.
 *
 * Handles all pre-flight validation (auth, chatroom access, machine registration,
 * participant join, init prompt) and then delegates to `WaitForTaskSession.start()`.
 */

import { HEARTBEAT_TTL_MS } from '@workspace/backend/config/reliability.js';
import { getWaitForTaskGuidance } from '@workspace/backend/prompts/base/cli/index.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';

import { WaitForTaskSession } from './session.js';
import { api, type Id } from '../../api.js';
import { getDriverRegistry } from '../../infrastructure/agent-drivers/index.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexUrl, getConvexClient } from '../../infrastructure/convex/client.js';
import { ensureMachineRegistered, type AgentHarness } from '../../infrastructure/machine/index.js';
import { isNetworkError, formatConnectivityError } from '../../utils/error-formatting.js';
import { sanitizeUnknownForTerminal } from '../../utils/terminal-safety.js';

// ─── Re-exports ─────────────────────────────────────────────────────────────

export { WaitForTaskSession } from './session.js';
export type { WaitForTaskResponse, SessionParams } from './session.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface WaitForTaskOptions {
  role: string;
  silent?: boolean;
  agentType?: AgentHarness;
}

// ─── Entry Point ────────────────────────────────────────────────────────────

/**
 * Wait for tasks in a chatroom.
 *
 * Handles all pre-flight validation (auth, chatroom access, machine registration,
 * participant join, init prompt) and then delegates to `WaitForTaskSession.start()`.
 */
export async function waitForTask(chatroomId: string, options: WaitForTaskOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, silent } = options;

  // Get Convex URL and CLI env prefix for generating commands
  const convexUrl = getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    const otherUrls = getOtherSessionUrls();

    console.error(`❌ Not authenticated for: ${convexUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom wait-for-task ...`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }

    console.error(`   chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format before query
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
  let chatroom;
  try {
    chatroom = await client.query(api.chatrooms.get, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });
  } catch (error) {
    if (isNetworkError(error)) {
      formatConnectivityError(error, convexUrl);
      process.exit(1);
    }
    throw error;
  }

  if (!chatroom) {
    console.error(`❌ Chatroom ${chatroomId} not found or access denied`);
    process.exit(1);
  }

  // Register machine and sync config to backend
  try {
    const machineInfo = ensureMachineRegistered();

    // Discover available models from installed harnesses (dynamic)
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
      // Model discovery is non-critical — continue with empty list
    }

    await client.mutation(api.machines.register, {
      sessionId,
      machineId: machineInfo.machineId,
      hostname: machineInfo.hostname,
      os: machineInfo.os,
      availableHarnesses: machineInfo.availableHarnesses,
      harnessVersions: machineInfo.harnessVersions,
      availableModels,
    });

    // Determine agent type (from flag or default to first available harness)
    const agentType: AgentHarness | undefined =
      options.agentType ??
      (machineInfo.availableHarnesses.length > 0 ? machineInfo.availableHarnesses[0] : undefined);

    if (agentType) {
      const workingDir = process.cwd();

      await client.mutation(api.machines.updateAgentConfig, {
        sessionId,
        machineId: machineInfo.machineId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
        agentType,
        workingDir,
      });
    }
  } catch (machineError) {
    if (!silent) {
      console.warn(
        `⚠️  Machine registration failed: ${sanitizeUnknownForTerminal((machineError as Error).message)}`
      );
    }
  }

  // Generate a unique connection ID for this wait-for-task session
  const connectionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Determine agent type ('custom' | 'remote') from team agent config
  let participantAgentType: 'custom' | 'remote' | undefined;
  try {
    const teamConfigs = await client.query(api.machines.getTeamAgentConfigs, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });
    const roleConfig = (teamConfigs as { role: string; type: 'custom' | 'remote' }[])?.find(
      (c) => c.role.toLowerCase() === role.toLowerCase()
    );
    participantAgentType = roleConfig?.type;
  } catch {
    // Non-critical — continue without agent type
  }

  // Join the chatroom with connectionId and initial readyUntil (heartbeat-based liveness)
  await client.mutation(api.participants.join, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
    readyUntil: Date.now() + HEARTBEAT_TTL_MS,
    connectionId,
    agentType: participantAgentType,
  });

  // Log initial connection with timestamp
  const connectionTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (!silent) {
    console.log(`[${connectionTime}] ⏳ Connecting to chatroom as "${role}"...`);
  }

  // On first session, fetch and display the full initialization prompt from backend
  try {
    const initPromptResult = await client.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      convexUrl,
    });

    if (initPromptResult?.prompt) {
      const connectedTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.log(`[${connectedTime}] ✅ Connected. Waiting for task...\n`);

      if (!initPromptResult.hasSystemPromptControl) {
        console.log('<!-- REFERENCE: Agent Initialization');
        console.log('');
        console.log('═'.repeat(50));
        console.log('📋 AGENT INITIALIZATION PROMPT');
        console.log('═'.repeat(50));
        console.log('');
        console.log(getWaitForTaskGuidance());
        console.log('');
        console.log('═'.repeat(50));
        console.log('');
        console.log(initPromptResult.prompt);
        console.log('');
        console.log('═'.repeat(50));
        console.log('-->');
        console.log('');
      }
    }
  } catch {
    // Fallback - init prompt not critical, continue without it
  }

  // --- Delegate to the session class ---
  const session = new WaitForTaskSession({
    chatroomId,
    role,
    silent: !!silent,
    sessionId,
    connectionId,
    cliEnvPrefix,
    client,
  });

  await session.start();
}
