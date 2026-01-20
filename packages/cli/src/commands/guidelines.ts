/**
 * Guidelines CLI Commands
 *
 * Commands for viewing review guidelines by type.
 */

import { api } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

export interface ViewGuidelinesOptions {
  type: string;
}

const VALID_TYPES = ['coding', 'security', 'design', 'performance', 'all'];

/**
 * View guidelines by type
 */
export async function viewGuidelines(options: ViewGuidelinesOptions): Promise<void> {
  const { type } = options;

  // Validate type
  if (!VALID_TYPES.includes(type)) {
    console.error(`❌ Invalid guideline type: "${type}"`);
    console.error(`   Valid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  const client = await getConvexClient();

  try {
    const result = (await client.query(api.guidelines.getGuidelines, {
      type: type as 'coding' | 'security' | 'design' | 'performance' | 'all',
    })) as { type: string; title: string; content: string };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📋 ${result.title}`);
    console.log(`${'═'.repeat(60)}\n`);
    console.log(result.content);
    console.log(`\n${'═'.repeat(60)}\n`);
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Error fetching guidelines: ${err.message}`);
    process.exit(1);
  }
}

/**
 * List available guideline types
 */
export async function listGuidelineTypes(): Promise<void> {
  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  const client = await getConvexClient();

  try {
    const types = (await client.query(api.guidelines.listGuidelineTypes, {})) as {
      type: string;
      description: string;
    }[];

    console.log(`\n📋 Available Guideline Types\n`);
    console.log(`${'─'.repeat(50)}`);

    for (const t of types) {
      console.log(`  ${t.type.padEnd(12)} - ${t.description}`);
    }

    console.log(`${'─'.repeat(50)}`);
    console.log(`\nUsage: chatroom guidelines view --type=<type>\n`);
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Error fetching guideline types: ${err.message}`);
    process.exit(1);
  }
}
