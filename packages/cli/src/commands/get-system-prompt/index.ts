/**
 * Get System Prompt CLI Command
 *
 * Fetches the full agent system prompt for a given role in a chatroom.
 * Useful for self-refresh after a crash or context compaction.
 */

import type { GetSystemPromptDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { GetSystemPromptDeps } from './deps.js';

export interface GetSystemPromptOptions {
  role: string;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<GetSystemPromptDeps> {
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

// ─── Entry Point ──────────────────────────────────────────────────────────

/**
 * Fetch and print the full agent system prompt for a given role in a chatroom.
 */
export async function getSystemPrompt(
  chatroomId: string,
  options: GetSystemPromptOptions,
  deps?: GetSystemPromptDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { role } = options;

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
    return;
  }

  const convexUrl = d.session.getConvexUrl();

  try {
    // Fetch chatroom data to get team info
    const chatroom = await d.backend.query(api.chatrooms.get, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });

    if (!chatroom) {
      console.error(`❌ Chatroom not found: ${chatroomId}`);
      process.exit(1);
      return;
    }

    // Fetch the full agent system prompt
    const prompt = await d.backend.query(api.prompts.webapp.getAgentPrompt, {
      chatroomId,
      role,
      teamName: chatroom.teamName,
      teamRoles: chatroom.teamRoles,
      teamEntryPoint: chatroom.teamEntryPoint,
      convexUrl: convexUrl ?? undefined,
    });

    console.log(prompt);
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Error fetching system prompt: ${err.message}`);
    process.exit(1);
    return;
  }
}
