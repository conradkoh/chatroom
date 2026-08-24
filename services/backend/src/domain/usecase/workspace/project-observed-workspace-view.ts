import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

const sortedUnique = (dirs: string[]) => [...new Set(dirs)].sort();

export async function rebuildObservedWorkspaceView(ctx: MutationCtx, machineId: string, chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  const observation = await ctx.db.query('chatroom_observation').withIndex('by_chatroomId', (q) => q.eq('chatroomId', chatroomId)).first();
  const workspaces = await ctx.db.query('chatroom_workspaces').withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId)).filter((q) => q.and(q.eq(q.field('machineId'), machineId), q.eq(q.field('removedAt'), undefined))).collect();
  const workingDirs = sortedUnique(workspaces.filter((ws) => isActiveWorkspace(ws.removedAt)).map((ws) => ws.workingDir));
  const existing = await ctx.db.query('chatroom_machineObservedWorkspaceViews').withIndex('by_machineId_chatroomId', (q) => q.eq('machineId', machineId).eq('chatroomId', chatroomId)).first();
  if (!observation || workingDirs.length === 0) { if (existing) await ctx.db.delete('chatroom_machineObservedWorkspaceViews', existing._id); return; }
  if (existing && existing.lastObservedAt === observation.lastObservedAt && existing.workingDirs.length === workingDirs.length && existing.workingDirs.every((d, i) => d === workingDirs[i])) return;
  const fields = { lastObservedAt: observation.lastObservedAt, workingDirs };
  if (existing) await ctx.db.patch('chatroom_machineObservedWorkspaceViews', existing._id, fields);
  else await ctx.db.insert('chatroom_machineObservedWorkspaceViews', { machineId, chatroomId, ...fields });
}

export async function rebuildObservedWorkspaceViewsForChatroom(ctx: MutationCtx, chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  const workspaces = await ctx.db.query('chatroom_workspaces').withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId)).filter((q) => q.eq(q.field('removedAt'), undefined)).collect();
  for (const machineId of [...new Set(workspaces.map((ws) => ws.machineId))]) await rebuildObservedWorkspaceView(ctx, machineId, chatroomId);
}

export async function deleteObservedWorkspaceViewsForMachine(ctx: MutationCtx, machineId: string): Promise<void> {
  const rows = await ctx.db.query('chatroom_machineObservedWorkspaceViews').withIndex('by_machineId', (q) => q.eq('machineId', machineId)).collect();
  for (const row of rows) await ctx.db.delete('chatroom_machineObservedWorkspaceViews', row._id);
}
