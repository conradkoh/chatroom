/**
 * Guidelines CLI Commands
 *
 * Commands for viewing review guidelines by type.
 */

import type { GuidelinesDeps } from './deps.js';
import { api } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { GuidelinesDeps } from './deps.js';
export interface ViewGuidelinesOptions {
  type: string;
}

const VALID_TYPES = ['coding', 'security', 'design', 'performance', 'all'];

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<GuidelinesDeps> {
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

// ─── Entry Points ──────────────────────────────────────────────────────────

/**
 * View guidelines by type
 */
export async function viewGuidelines(
  options: ViewGuidelinesOptions,
  deps?: GuidelinesDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { type } = options;

  // Validate type
  if (!VALID_TYPES.includes(type)) {
    console.error(`❌ Invalid guideline type: "${type}"`);
    console.error(`   Valid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
    return;
  }

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
    return;
  }

  try {
    const result = await d.backend.query(api.guidelines.getGuidelines, {
      type: type as 'coding' | 'security' | 'design' | 'performance' | 'all',
    });

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📋 ${result.title}`);
    console.log(`${'═'.repeat(60)}\n`);
    console.log(result.content);
    console.log(`\n${'═'.repeat(60)}\n`);
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Error fetching guidelines: ${err.message}`);
    process.exit(1);
    return;
  }
}

/**
 * List available guideline types
 */
export async function listGuidelineTypes(deps?: GuidelinesDeps): Promise<void> {
  const d = deps ?? (await createDefaultDeps());

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
    return;
  }

  try {
    const types = await d.backend.query(api.guidelines.listGuidelineTypes, {});

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
    return;
  }
}
