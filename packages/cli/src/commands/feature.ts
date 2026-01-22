/**
 * Feature commands for listing and inspecting features
 */

import { api, type Id } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface FeatureSummary {
  id: string;
  title: string;
  descriptionPreview?: string;
  createdAt: number;
}

interface FeatureDetails {
  feature: {
    id: string;
    title: string;
    description?: string;
    techSpecs?: string;
    content: string;
    createdAt: number;
  };
  thread: {
    id: string;
    senderRole: string;
    content: string;
    type: string;
    createdAt: number;
  }[];
}

/**
 * List features in a chatroom
 */
export async function listFeatures(
  chatroomId: string,
  options: {
    limit?: number;
  }
): Promise<void> {
  // Show deprecation warning
  console.log('⚠️  DEPRECATION WARNING:');
  console.log(
    '   The `chatroom feature list` command is deprecated and will be removed in a future version.'
  );
  console.log('   Features are now managed through the task system and backlog.');
  console.log('   Use `chatroom backlog list` instead to see all tasks including features.');
  console.log('');
  console.log('   This command will continue to work temporarily but will be removed.');
  console.log('');

  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
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

  try {
    const features = (await client.query(api.messages.listFeatures, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      limit: options.limit || 10,
    })) as FeatureSummary[];

    // Display header
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('📦 FEATURES');
    console.log('══════════════════════════════════════════════════');
    console.log(`Chatroom: ${chatroomId}`);
    console.log('');

    if (features.length === 0) {
      console.log('No features found.');
      console.log('');
      console.log('💡 Features are created when an agent classifies a task as new_feature');
      console.log('   and provides a title, description, and technical specifications.');
    } else {
      console.log('──────────────────────────────────────────────────');
      console.log('📝 FEATURE LIST');
      console.log('──────────────────────────────────────────────────');

      for (let i = 0; i < features.length; i++) {
        const feature = features[i]!;
        const date = new Date(feature.createdAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        console.log(`#${i + 1} ${feature.title}`);
        if (feature.descriptionPreview) {
          console.log(`   ${feature.descriptionPreview}`);
        }
        console.log(`   ID: ${feature.id}`);
        console.log(`   Created: ${date}`);
        console.log('');
      }
    }

    console.log('──────────────────────────────────────────────────');
    console.log(`Showing ${features.length} feature(s)`);
    console.log('');
    console.log('💡 Use `chatroom feature inspect <chatroomId> <messageId>` for full details');
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to list features: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Inspect a specific feature
 */
export async function inspectFeature(chatroomId: string, messageId: string): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
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

  // Validate message ID
  if (!messageId || messageId.trim().length === 0) {
    console.error(`❌ Message ID is required`);
    process.exit(1);
  }

  try {
    const result = (await client.query(api.messages.inspectFeature, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      messageId: messageId as Id<'chatroom_messages'>,
    })) as FeatureDetails;

    const { feature, thread } = result;
    const date = new Date(feature.createdAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    // Display header
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log(`📦 FEATURE: ${feature.title}`);
    console.log('══════════════════════════════════════════════════');
    console.log(`ID: ${feature.id}`);
    console.log(`Created: ${date}`);
    console.log('');

    // Description
    if (feature.description) {
      console.log('──────────────────────────────────────────────────');
      console.log('📝 DESCRIPTION');
      console.log('──────────────────────────────────────────────────');
      console.log(feature.description);
      console.log('');
    }

    // Tech specs
    if (feature.techSpecs) {
      console.log('──────────────────────────────────────────────────');
      console.log('🔧 TECHNICAL SPECIFICATIONS');
      console.log('──────────────────────────────────────────────────');
      console.log(feature.techSpecs);
      console.log('');
    }

    // Original request
    console.log('──────────────────────────────────────────────────');
    console.log('💬 ORIGINAL REQUEST');
    console.log('──────────────────────────────────────────────────');
    console.log(feature.content);
    console.log('');

    // Thread
    if (thread.length > 0) {
      console.log('──────────────────────────────────────────────────');
      console.log('📜 CONVERSATION THREAD');
      console.log('──────────────────────────────────────────────────');

      for (const msg of thread) {
        const msgDate = new Date(msg.createdAt).toLocaleString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        const typeLabel = msg.type === 'handoff' ? ' [handoff]' : '';
        console.log(`[${msgDate}] ${msg.senderRole}${typeLabel}:`);
        console.log(`  ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
        console.log('');
      }
    }

    console.log('══════════════════════════════════════════════════');
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to inspect feature: ${(error as Error).message}`);
    process.exit(1);
  }
}
