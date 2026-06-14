/**
 * Codemap xray command.
 *
 * Views a codemap from a sub-agent instance, showing the research findings.
 * Reads the codemap file from the working directory if available.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { api, type Id } from '../../../api.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';

export async function codemapXray(chatroomId: string, instanceId: string): Promise<void> {
  const sessionId = await getSessionId();
  if (!sessionId) {
    console.error('❌ Not authenticated. Run `chatroom auth login` first.');
    process.exit(1);
  }

  const client = await getConvexClient();

  try {
    const instance = await client.query(api.subAgents.getSubAgentInstance, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      instanceId,
    });

    if (!instance) {
      console.error(`❌ Sub-agent instance '${instanceId}' not found.`);
      process.exit(1);
    }

    console.log(`\nCodemap: ${instance.codemapName || 'Untitled'}\n`);
    console.log('='.repeat(80));

    if (instance.codemapPath) {
      console.log(`Path: ${instance.codemapPath}`);
      console.log('='.repeat(80));

      // Try to read the codemap file from the working directory
      const codemapFilePath = join(process.cwd(), instance.codemapPath);
      try {
        const content = readFileSync(codemapFilePath, 'utf-8');
        console.log('\n' + content);
      } catch {
        console.log('\n⚠️  Codemap file not found at:', codemapFilePath);
        console.log(
          '  The file may not have been written yet, or the working directory has changed.'
        );
      }
    } else {
      console.log('No codemap content available yet.');
    }

    console.log('\n' + '='.repeat(80));
    console.log(`Status: ${instance.status}`);
    console.log(`Type: ${instance.subAgentType}`);
    console.log(`Created: ${new Date(instance.createdAt).toISOString()}`);
    if (instance.completedAt) {
      console.log(`Completed: ${new Date(instance.completedAt).toISOString()}`);
    }
    if (instance.briefing) {
      console.log(`\nBriefing:`);
      console.log(instance.briefing);
    }
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('❌ Failed to view codemap:', getErrorMessage(error));
    process.exit(1);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
