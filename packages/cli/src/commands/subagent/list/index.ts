/**
 * Sub-agent list command.
 *
 * Lists all sub-agents for a chatroom, showing their status and details.
 */

import { api, type Id } from '../../../api.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';

export async function listSubAgents(chatroomId: string): Promise<void> {
  const sessionId = await getSessionId();
  if (!sessionId) {
    console.error('❌ Not authenticated. Run `chatroom auth login` first.');
    process.exit(1);
  }

  const client = await getConvexClient();

  try {
    const instances = await client.query(api.subAgents.listSubAgents, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });

    if (instances.length === 0) {
      console.log('No sub-agents found for this chatroom.');
      return;
    }

    console.log(`\nSub-agents for chatroom ${chatroomId}:\n`);
    console.log('-'.repeat(80));

    for (const instance of instances) {
      console.log(`Instance: ${instance.instanceId}`);
      console.log(`  Type: ${instance.subAgentType}`);
      console.log(`  Status: ${instance.status}`);
      console.log(`  Parent: ${instance.parentRole}`);
      if (instance.codemapName) {
        console.log(`  Codemap: ${instance.codemapName}`);
      }
      if (instance.codemapPath) {
        console.log(`  Path: ${instance.codemapPath}`);
      }
      console.log(`  Created: ${new Date(instance.createdAt).toISOString()}`);
      if (instance.completedAt) {
        console.log(`  Completed: ${new Date(instance.completedAt).toISOString()}`);
      }
      console.log('-'.repeat(80));
    }

    console.log(`\nTotal: ${instances.length} sub-agent(s)\n`);
  } catch (error) {
    console.error('❌ Failed to list sub-agents:', getErrorMessage(error));
    process.exit(1);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
