/**
 * Get Next Task Command — entry point.
 *
 * Handles all pre-flight validation (auth, chatroom access, machine registration,
 * participant join, init prompt) and then delegates to `GetNextTaskSession.start()`.
 */

import { getNextTaskGuidance } from '@workspace/backend/prompts/cli/index.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';

import { GetNextTaskSession } from './session.js';
import { api, type Id } from '../../api.js';
import { getOtherSessionUrls, getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import { ensureMachineRegistered } from '../../infrastructure/machine/index.js';
import { CursorAgentService } from '../../infrastructure/services/remote-agents/cursor/index.js';
import { OpenCodeAgentService } from '../../infrastructure/services/remote-agents/opencode/index.js';
import { PiAgentService } from '../../infrastructure/services/remote-agents/pi/index.js';
import { formatConnectivityError, isNetworkError } from '../../utils/error-formatting.js';
import { sanitizeUnknownForTerminal } from '../../utils/terminal-safety.js';

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type { SessionParams, GetNextTaskResponse, WaitForTaskResponse } from './session.js';
export { GetNextTaskSession } from './session.js';

/** @deprecated Use GetNextTaskSession instead */
export { GetNextTaskSession as WaitForTaskSession } from './session.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GetNextTaskOptions {
  role: string;
  silent?: boolean;
}

// ─── Entry Point ────────────────────────────────────────────────────────────

/**
 * Get next task from a chatroom.
 *
 * Handles all pre-flight validation (auth, chatroom access, machine registration,
 * participant join, init prompt) and then delegates to `GetNextTaskSession.start()`.
 */
export async function getNextTask(chatroomId: string, options: GetNextTaskOptions): Promise<void> {
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
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom get-next-task ...`);
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
    try {
      const cursorService = new CursorAgentService();
      if (cursorService.isInstalled()) {
        availableModels['cursor'] = await cursorService.listModels();
      }
    } catch {
      /* non-critical */
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
  } catch (machineError) {
    if (!silent) {
      console.warn(
        `⚠️  Machine registration failed: ${sanitizeUnknownForTerminal((machineError as Error).message)}`
      );
    }
  }

  // Generate a unique connection ID for this get-next-task session
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

  // Join the chatroom, recording the start action for lastSeenAction-based liveness
  await client.mutation(api.participants.join, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
    action: 'get-next-task:started',
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
        console.log(getNextTaskGuidance());
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
  const session = new GetNextTaskSession({
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
