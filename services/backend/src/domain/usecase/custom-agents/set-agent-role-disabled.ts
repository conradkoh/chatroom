/**
 * Use Case: Set Agent Role Disabled
 *
 * Disabling is per chatroom and never touches the authored definition files.
 * The resolved roster is the source of truth for existence and disableability:
 * its `disableable` flag is computed from the combined builtin + custom
 * structure before disabled rows are filtered out, so permanent roles and entry
 * points stay protected while builtin and custom ephemeral roles do not.
 */

import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { findActiveAssignedTaskForRole } from '../task/find-acknowledged-task-for-role';
import { resolveChatroomTeam } from '../team/resolve-chatroom-team';

export interface SetAgentRoleDisabledInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  disabled: boolean;
  userId: Id<'users'>;
}

function cannotDisable(
  message: string
): ConvexError<{ code: 'ROLE_NOT_DISABLEABLE'; message: string }> {
  return new ConvexError({ code: 'ROLE_NOT_DISABLEABLE', message });
}

async function findDisabledRow(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<Doc<'chatroom_disabledAgentRoles'> | null> {
  const row = await ctx.db
    .query('chatroom_disabledAgentRoles')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .first();
  return row ?? null;
}

async function assertRoleCanBeDisabled(
  ctx: MutationCtx,
  input: SetAgentRoleDisabledInput
): Promise<void> {
  const resolved = await resolveChatroomTeam(ctx, input.chatroomId);
  const entry = resolved?.roster.find((candidate) => candidate.role === input.role);
  if (!entry) {
    throw new ConvexError({
      code: 'ROLE_NOT_FOUND',
      message: `Role "${input.role}" is not part of this chatroom's team`,
    });
  }
  if (!entry.disableable) {
    throw cannotDisable(`Role "${input.role}" cannot be disabled`);
  }
}

async function insertDisabledRow(
  ctx: MutationCtx,
  input: SetAgentRoleDisabledInput
): Promise<void> {
  const activeTask = await findActiveAssignedTaskForRole(ctx, {
    chatroomId: input.chatroomId,
    role: input.role,
  });
  if (activeTask) {
    throw new ConvexError({
      code: 'ROLE_BUSY',
      message: `Role "${input.role}" has an active assigned task`,
    });
  }
  await ctx.db.insert('chatroom_disabledAgentRoles', {
    chatroomId: input.chatroomId,
    role: input.role,
    disabledBy: input.userId,
    disabledAt: Date.now(),
  });
}

/**
 * Inserts or deletes the per-chatroom disabled row idempotently. Repeating the
 * same request returns `{ changed: false }` without touching the row.
 */
export async function setAgentRoleDisabled(
  ctx: MutationCtx,
  input: SetAgentRoleDisabledInput
): Promise<{ changed: boolean }> {
  await assertRoleCanBeDisabled(ctx, input);

  const existing = await findDisabledRow(ctx, input.chatroomId, input.role);
  if (input.disabled === (existing !== null)) return { changed: false };

  if (input.disabled) {
    await insertDisabledRow(ctx, input);
  } else if (existing) {
    await ctx.db.delete('chatroom_disabledAgentRoles', existing._id);
  }
  return { changed: true };
}
