/**
 * Sub-agent spawn command.
 *
 * Spawns a new sub-agent of the specified type (e.g., codemapper)
 * with the given briefing and configuration.
 */

import { api, type Id } from '../../../api.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';

export interface SpawnSubAgentOptions {
  type: string;
  name: string;
  briefing: string;
  machineId?: string;
  parentRole?: string;
}

export async function spawnSubAgent(
  chatroomId: string,
  options: SpawnSubAgentOptions
): Promise<void> {
  const sessionId = await getSessionId();
  if (!sessionId) {
    console.error('❌ Not authenticated. Run `chatroom auth login` first.');
    process.exit(1);
  }

  const client = await getConvexClient();

  try {
    const result = await client.mutation(api.subAgents.spawnSubAgent, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      subAgentType: options.type as 'codemapper',
      codemapName: options.name,
      briefing: options.briefing,
      parentRole: options.parentRole || 'planner',
      machineId: options.machineId,
    });

    console.log(`✅ Sub-agent spawned successfully!`);
    console.log(`   Instance ID: ${result.instanceId}`);
    console.log(`   Role: ${result.role}`);
    console.log(`   Status: ${result.status}`);
  } catch (error) {
    console.error('❌ Failed to spawn sub-agent:', getErrorMessage(error));
    process.exit(1);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
