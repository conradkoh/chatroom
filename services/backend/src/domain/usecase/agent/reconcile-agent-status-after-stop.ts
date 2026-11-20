import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';

type RoleStatusRow = Doc<'chatroom_agentRoleStatusReadModel'>;

/** Statuses that claim a live process. A completed stop makes them stale. */
const LIVE_CLAIM_STATUSES: ReadonlySet<RoleStatusRow['status']> = new Set([
  'starting',
  'waiting',
  'working',
  'stopping',
]);

export interface StopScope {
  chatroomId: Id<'chatroom_rooms'>;
  role?: string | undefined;
  workingDir?: string | undefined;
}

function isSameWorkingDir(rowDir: string | undefined, scopeDir: string): boolean {
  if (rowDir === undefined) return false;
  try {
    return normalizeWorkingDir(rowDir) === normalizeWorkingDir(scopeDir);
  } catch {
    return false;
  }
}

// fallow-ignore-next-line complexity
function isInStopScope(row: RoleStatusRow, scope: StopScope): boolean {
  if (scope.role && row.role !== scope.role.trim().toLowerCase()) return false;
  if (scope.workingDir && !isSameWorkingDir(row.workingDir, scope.workingDir)) return false;
  return true;
}

function claimsLiveProcess(row: RoleStatusRow): boolean {
  return LIVE_CLAIM_STATUSES.has(row.status) || row.observedPid !== undefined;
}

/**
 * Resets role status rows that a completed `agent.stop` left claiming a live
 * process. Called only after the daemon confirmed every process in scope is
 * stopped (`chatroom_shutdown_complete`). Ordering and machine guards live in
 * `projectAgentRoleStatusReadModel`.
 */
// fallow-ignore-next-line complexity
export async function reconcileAgentStatusAfterStop(
  ctx: MutationCtx,
  args: {
    machineId: string;
    scope: StopScope;
    emittedAt: number;
    revisionKey: string;
  }
): Promise<{ reconciledCount: number }> {
  const rows = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.scope.chatroomId))
    .collect();
  let reconciledCount = 0;
  for (const row of rows) {
    if (row.machineId !== args.machineId) continue;
    if (!claimsLiveProcess(row)) continue;
    if (!isInStopScope(row, args.scope)) continue;
    const result = await projectAgentRoleStatusReadModel(ctx, {
      chatroomId: row.chatroomId,
      workspaceId: row.workspaceId,
      role: row.role,
      event: { status: 'offline' },
      sourceMachineId: args.machineId,
      sourceEventAt: args.emittedAt,
      sourceRevisionKey: args.revisionKey,
      clearObservedPid: true,
      observedAt: args.emittedAt,
    });
    if (result.applied) reconciledCount++;
  }
  return { reconciledCount };
}
