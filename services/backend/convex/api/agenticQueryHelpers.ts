/**
 * Helper utilities for the agentic-query backend module.
 */

import { ConvexError } from 'convex/values';

import { featureFlags } from '../../config/featureFlags';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { AuthenticatedChatroomAccess } from '../auth/chatroomAccess';
import { requireChatroomAccess } from '../auth/chatroomAccess';
import { type MachineAuth, requireMachineOwner } from '../auth/cli/machineAccess';

export function requireDirectHarnessWorkers(): void {
  if (!featureFlags.directHarnessWorkers) {
    throw new ConvexError('directHarnessWorkers feature flag is disabled');
  }
}

export async function getNextRunTurnSeq(
  ctx: { db: MutationCtx['db'] },
  runId: Id<'chatroom_agenticQueryRuns'>
): Promise<number> {
  const lastTurn = await ctx.db
    .query('chatroom_agenticQueryRunTurns')
    .withIndex('by_run_turnSeq', (q) => q.eq('runId', runId))
    .order('desc')
    .first();
  return (lastTurn?.turnSeq ?? 0) + 1;
}

export function requireOpencodeRun(
  run: Doc<'chatroom_agenticQueryRuns'>
): Extract<Doc<'chatroom_agenticQueryRuns'>, { type: 'opencode' }> {
  if (run.type !== 'opencode') {
    throw new ConvexError({
      code: 'UNSUPPORTED_HARNESS_TYPE',
      message: `Expected opencode run but got type='${run.type}'`,
    });
  }
  return run;
}

async function loadRunAndWorkspace(
  ctx: QueryCtx | MutationCtx,
  runId: Id<'chatroom_agenticQueryRuns'>
): Promise<{ run: Doc<'chatroom_agenticQueryRuns'>; workspace: Doc<'chatroom_workspaces'> }> {
  const run = await ctx.db.get('chatroom_agenticQueryRuns', runId);
  if (!run)
    throw new ConvexError({ code: 'NOT_FOUND', message: `Agentic query run ${runId} not found` });
  const workspace = await ctx.db.get('chatroom_workspaces', run.workspaceId);
  if (!workspace)
    throw new ConvexError({ code: 'NOT_FOUND', message: `Workspace ${run.workspaceId} not found` });
  return { run, workspace };
}

export interface RunAccess extends AuthenticatedChatroomAccess {
  run: Doc<'chatroom_agenticQueryRuns'>;
  workspace: Doc<'chatroom_workspaces'>;
}

export async function getRunWithAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  runId: Id<'chatroom_agenticQueryRuns'>
): Promise<RunAccess> {
  const { run, workspace } = await loadRunAndWorkspace(ctx, runId);
  const chatroomAccess = await requireChatroomAccess(ctx, sessionId, workspace.chatroomId);
  return { ...chatroomAccess, run, workspace };
}

export interface RunOnMachineAccess {
  auth: MachineAuth;
  run: Doc<'chatroom_agenticQueryRuns'>;
  workspace: Doc<'chatroom_workspaces'>;
}

export async function requireRunOnOwnedMachine(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  machineId: string,
  runId: Id<'chatroom_agenticQueryRuns'>
): Promise<RunOnMachineAccess> {
  const auth = await requireMachineOwner(ctx, sessionId, machineId);
  const { run, workspace } = await loadRunAndWorkspace(ctx, runId);

  if (workspace.machineId !== machineId) {
    throw new ConvexError({
      code: 'NOT_AUTHORIZED_MACHINE',
      message: 'Run does not belong to this machine',
    });
  }

  return { auth, run, workspace };
}
