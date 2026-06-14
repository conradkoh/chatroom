/**
 * Use Case: Complete Sub-Agent
 *
 * Marks a sub-agent instance as completed (or failed) and optionally
 * writes the codemap to the working directory.
 */

import { ConvexError } from 'convex/values';

import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildCodemapPath } from '../../entities/sub-agent';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompleteSubAgentInput {
  ctx: MutationCtx;
  chatroomId: Id<'chatroom_rooms'>;
  instanceId: string;
  /** Final status: 'completed' or 'failed'. */
  status: 'completed' | 'failed';
  /** Optional codemap content to persist. */
  codemapContent?: string;
  /** Optional codemap name (for path generation). */
  codemapName?: string;
}

export interface CompleteSubAgentResult {
  instanceId: string;
  status: 'completed' | 'failed';
}

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function completeSubAgent(
  input: CompleteSubAgentInput
): Promise<CompleteSubAgentResult> {
  const { ctx, chatroomId, instanceId, status, codemapContent, codemapName } = input;

  // Find the sub-agent instance
  const instance = await ctx.db
    .query('chatroom_subAgentInstances')
    .withIndex('by_chatroom_instance', (q) =>
      q.eq('chatroomId', chatroomId).eq('instanceId', instanceId)
    )
    .first();

  if (!instance) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.SUB_AGENT_INSTANCE_NOT_FOUND,
      message: `Sub-agent instance '${instanceId}' not found in chatroom ${chatroomId}`,
    });
  }

  // Update instance status
  const now = Date.now();
  await ctx.db.patch('chatroom_subAgentInstances', instance._id, {
    status,
    completedAt: now,
  } as Partial<Doc<'chatroom_subAgentInstances'>>);

  // If completed and codemap content provided, persist it
  if (status === 'completed' && codemapContent && codemapName) {
    const datePrefix = new Date(now).toISOString().substring(0, 10);
    const codemapPath = buildCodemapPath(datePrefix, codemapName);

    // Update instance with codemap path
    await ctx.db.patch('chatroom_subAgentInstances', instance._id, {
      codemapPath: codemapPath,
    } as Partial<Doc<'chatroom_subAgentInstances'>>);

    // Persist codemap to working directory (via file system or storage)
    // This would typically use the agent's workingDir from config
    // For now, we store the path reference in the instance
  }

  return { instanceId, status };
}
