import { ConvexError } from 'convex/values';

import { ENHANCER_RETRY_BASE_MS } from '../../../config/reliability';
import { getHandoffTemplate } from '../../../prompts/cli/handoff-templates';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export async function resolveWorkspaceForEnhancer(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string
): Promise<Doc<'chatroom_workspaces'>> {
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const match = workspaces.find((w) => w.machineId === machineId && w.removedAt === undefined);
  if (!match) {
    throw new ConvexError({
      code: 'WORKSPACE_NOT_FOUND',
      message: `No workspace found for machine ${machineId} in chatroom`,
    });
  }
  return match;
}

export function computeEnhancerBackoffMs(attemptCount: number): number {
  return ENHANCER_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1);
}

/** Compatibility no-op: enhancer job rows are authoritative. */
export async function emitEnhancerEvent(
  _ctx: MutationCtx,
  _event: Record<string, unknown>,
  _timestamp: number
): Promise<void> {}

export function resolveHandoffTemplateSnapshot(
  chatroom: Doc<'chatroom_rooms'>,
  chatroomId: Id<'chatroom_rooms'>,
  entryPointRole: string
): string {
  const template = getHandoffTemplate({
    teamId: chatroom.teamId,
    fromRole: 'enhancer',
    toRole: entryPointRole,
    nativeIntegration: false,
    chatroomId,
    role: 'enhancer',
  });
  if (!template) {
    throw new ConvexError({
      code: 'TEMPLATE_NOT_FOUND',
      message: `No handoff template for enhancer→${entryPointRole}`,
    });
  }
  return template;
}
