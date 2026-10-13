/**
 * Git clone requests from the New Chatroom wizard (`api.gitCloneRequests.*`).
 *
 * Lifecycle (server-enforced, monotonic): pending → cloning → completed | failed.
 * pending → completed | failed is also allowed. Terminal rows are immutable.
 * Late or duplicate reports never throw; they return `ignored` / `duplicate` flags instead.
 *
 * The daemon performs the clone. This module only records state and enqueues `daemon.gitClone`.
 */

import { type GitCloneErrorCode, validateGitCloneUrl } from '@workspace/shared/domain/git-clone';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { getSession } from './auth/session';
import { normalizeWorkingDir } from './workspacePathSecurity';
import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import { gitCloneErrorCodeValidator } from '../src/domain/entities/git-clone-request';
import { enqueueMachineCommand } from '../src/domain/usecase/machine/enqueue-machine-command';

/** Maximum stored length for a progress phase label. Longer values are truncated. */
const GIT_CLONE_PHASE_MAX_LENGTH = 64;
/** Maximum stored length for a result error message. Longer values are truncated. */
const GIT_CLONE_ERROR_MESSAGE_MAX_LENGTH = 2000;

type GitCloneRequestRow = Doc<'chatroom_gitCloneRequests'>;

function isTerminal(row: GitCloneRequestRow): boolean {
  return row.status === 'completed' || row.status === 'failed';
}

/** Loads a request and ensures it belongs to the machine the caller already authorized. */
async function getRequestForMachine(
  ctx: MutationCtx,
  requestId: GitCloneRequestRow['_id'],
  machineId: string
): Promise<GitCloneRequestRow> {
  const row = await ctx.db.get('chatroom_gitCloneRequests', requestId);
  if (!row) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.GIT_CLONE_REQUEST_NOT_FOUND,
      message: 'Git clone request not found',
    });
  }
  if (row.machineId !== machineId) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE,
      message: 'Git clone request does not belong to this machine',
    });
  }
  return row;
}

/** Clamps to 0–100 and rounds. NaN is treated as "no percent" rather than stored. */
function normalizeProgressPercent(percent: number | undefined): number | undefined {
  if (percent === undefined || Number.isNaN(percent)) return undefined;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

/** A completed clone must have landed exactly at the requested target path. */
function assertClonedPathMatchesTarget(clonedPath: string | undefined, targetPath: string): void {
  if (!clonedPath || normalizeWorkingDir(clonedPath) !== targetPath) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.GIT_CLONE_PATH_MISMATCH,
      message: 'Cloned path does not match the requested target path',
    });
  }
}

/** Patch that makes a row terminal. Error fields are stored only for failed results. */
function terminalResultPatch(
  result: {
    status: 'completed' | 'failed';
    errorCode?: GitCloneErrorCode | undefined;
    errorMessage?: string | undefined;
  },
  now: number
) {
  if (result.status === 'completed') {
    return {
      status: 'completed' as const,
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: now,
      completedAt: now,
    };
  }
  return {
    status: 'failed' as const,
    errorCode: result.errorCode ?? 'unknown',
    errorMessage: result.errorMessage?.slice(0, GIT_CLONE_ERROR_MESSAGE_MAX_LENGTH),
    updatedAt: now,
    completedAt: now,
  };
}

/**
 * Queue a clone for a machine owned by the caller.
 * Validates the URL and target path, inserts a pending row, and enqueues `daemon.gitClone`.
 */
export const request = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    repoUrl: v.string(),
    targetPath: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const url = validateGitCloneUrl(args.repoUrl);
    if (!url.ok) {
      throw new ConvexError({ code: BACKEND_ERROR_CODES.INVALID_REPO_URL, message: url.reason });
    }

    // Throws on relative paths, `~`, and the filesystem root.
    const targetPath = normalizeWorkingDir(args.targetPath);

    const now = Date.now();
    const requestId = await ctx.db.insert('chatroom_gitCloneRequests', {
      userId: auth.userId,
      machineId: args.machineId,
      repoUrl: url.url,
      targetPath,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      now,
      command: { type: 'daemon.gitClone', requestId, repoUrl: url.url, targetPath },
    });

    return { requestId };
  },
});

/** Poll a clone request from the webapp. Returns null for unknown or other users' requests. */
export const get = query({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_gitCloneRequests'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    const row = await ctx.db.get('chatroom_gitCloneRequests', args.requestId);
    if (!row || row.userId !== auth.userId) return null;
    return row;
  },
});

/** Called by the daemon while a clone is running. Moves pending → cloning. */
export const reportProgress = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    requestId: v.id('chatroom_gitCloneRequests'),
    phase: v.string(),
    percent: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const row = await getRequestForMachine(ctx, args.requestId, args.machineId);

    // Late progress after a terminal result is dropped, not an error: the daemon may race.
    if (isTerminal(row)) {
      return { ok: true as const, ignored: true as const };
    }

    await ctx.db.patch('chatroom_gitCloneRequests', args.requestId, {
      status: 'cloning',
      progressPhase: args.phase.slice(0, GIT_CLONE_PHASE_MAX_LENGTH),
      progressPercent: normalizeProgressPercent(args.percent),
      updatedAt: Date.now(),
    });

    return { ok: true as const };
  },
});

/**
 * Called by the daemon once the clone finishes. Terminal and immutable.
 * `completed` must confirm the cloned path equals the requested target path.
 */
export const reportResult = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    requestId: v.id('chatroom_gitCloneRequests'),
    status: v.union(v.literal('completed'), v.literal('failed')),
    clonedPath: v.optional(v.string()),
    errorCode: v.optional(gitCloneErrorCodeValidator),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const row = await getRequestForMachine(ctx, args.requestId, args.machineId);

    // Duplicate results are a no-op. The first terminal result wins.
    if (isTerminal(row)) {
      return { ok: true as const, duplicate: true as const };
    }

    if (args.status === 'completed') {
      assertClonedPathMatchesTarget(args.clonedPath, row.targetPath);
    }

    await ctx.db.patch(
      'chatroom_gitCloneRequests',
      args.requestId,
      terminalResultPatch(args, Date.now())
    );

    return { ok: true as const };
  },
});
