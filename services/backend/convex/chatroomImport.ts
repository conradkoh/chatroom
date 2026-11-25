/**
 * Chatroom import — Convex queries and mutations.
 *
 * `preflight` is the only read the import needs from the target deployment: the
 * machine's identity and harnesses, whether the file's team structure exists
 * here, and which working directories this machine would reject. The CLI calls
 * it before building a plan.
 *
 * The four mutations are thin auth wrappers over the apply core in
 * `src/domain/usecase/chatroom-transfer/import-apply.ts`:
 *
 * - `begin` creates the archived target room.
 * - `applyChunk` writes one chunk of rows.
 * - `finalize` activates the room and starts it read.
 * - `rollback` drains a partial import in budgeted batches.
 *
 * Auth order is session → machine row → machine owner. The machine row must exist
 * before the owner check so an unknown machine reports `IMPORT_MACHINE_NOT_FOUND`
 * rather than the generic auth code, and an owned-by-someone-else machine reports
 * `IMPORT_MACHINE_NOT_OWNED` rather than leaking through `NOT_AUTHORIZED_MACHINE`.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { requireSession } from './auth/session';
import { validateWorkingDir } from './workspacePathSecurity';
import { getTeamPreset } from '../src/domain/entities/team-presets';
import type {
  ImportChunk,
  ImportHeader,
} from '../src/domain/usecase/chatroom-transfer/import-apply';
import {
  applyImportChunk,
  beginImport,
  finalizeImport,
  rollbackImportBatch,
} from '../src/domain/usecase/chatroom-transfer/import-apply';

/** The auth code `requireMachineOwner` throws when the caller is not the owner. */
const NOT_AUTHORIZED_MACHINE = 'NOT_AUTHORIZED_MACHINE';

export const preflight = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    teamStructureId: v.string(),
    workingDirs: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    await requireSession(ctx, a.sessionId);
    const machine = await requireMachine(ctx, a.machineId);
    await requireOwnedMachine(ctx, a.sessionId, a.machineId);
    const availableHarnesses = await readAvailableHarnesses(ctx, a.machineId);

    return {
      hostname: machine.hostname,
      availableHarnesses,
      teamStructureKnown: getTeamPreset(a.teamStructureId) !== undefined,
      invalidWorkingDirs: a.workingDirs.filter((dir) => !isValidWorkingDir(dir)),
    };
  },
});

/** Room-level values the import writes onto the new chatroom. */
const importHeaderValidator = v.object({
  teamStructureId: v.string(),
  name: v.optional(v.string()),
  standingInstructions: v.optional(v.string()),
  standingInstructionsEnabled: v.optional(v.boolean()),
  standingInstructionsTitle: v.optional(v.string()),
});

export const begin = mutation({
  args: {
    ...SessionIdArg,
    header: importHeaderValidator,
    machineId: v.string(),
  },
  handler: async (ctx, a) => {
    // The security scan needs the session helper in this handler; the wrapped
    // machine check below resolves the same session and the machine owner.
    await requireSession(ctx, a.sessionId);
    const auth = await requireOwnedMachine(ctx, a.sessionId, a.machineId);
    return await beginImport(ctx, {
      ownerId: auth.userId,
      header: a.header as ImportHeader,
      machineId: a.machineId,
    });
  },
});

export const applyChunk = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    chunk: v.any(),
  },
  handler: async (ctx, a) => {
    const auth = await requireSession(ctx, a.sessionId);
    const chunk = a.chunk as ImportChunk;
    await requireChunkMachine(ctx, a.sessionId, chunk);
    return await applyImportChunk(ctx, {
      ownerId: auth.userId,
      chatroomId: a.chatroomId,
      chunk,
    });
  },
});

export const finalize = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    status: v.union(v.literal('active'), v.literal('completed')),
    lastActivityAt: v.union(v.number(), v.null()),
    nextQueuePosition: v.number(),
  },
  handler: async (ctx, a) => {
    const auth = await requireSession(ctx, a.sessionId);
    await finalizeImport(ctx, {
      ownerId: auth.userId,
      chatroomId: a.chatroomId,
      status: a.status,
      lastActivityAt: a.lastActivityAt,
      nextQueuePosition: a.nextQueuePosition,
    });
    return null;
  },
});

export const rollback = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, a) => {
    const auth = await requireSession(ctx, a.sessionId);
    return await rollbackImportBatch(ctx, {
      ownerId: auth.userId,
      chatroomId: a.chatroomId,
    });
  },
});

/**
 * Machine-scoped chunks carry the target machine. A missing or non-string
 * `machineId` is a chunk failure, not an auth failure, so it is rejected before
 * the owner check.
 */
// fallow-ignore-next-line complexity
async function requireChunkMachine(
  ctx: MutationCtx,
  sessionId: string,
  chunk: ImportChunk
): Promise<void> {
  const record = chunk as unknown;
  if (typeof record !== 'object' || record === null) return;
  const { phase, machineId } = record as { phase?: unknown; machineId?: unknown };
  if (phase !== 'workspaces' && phase !== 'agentConfigs') return;
  if (typeof machineId !== 'string') {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.IMPORT_CHUNK_FAILED,
      message: 'a machine-scoped chunk needs a machineId',
    });
  }
  await requireOwnedMachine(ctx, sessionId, machineId);
}

async function requireMachine(ctx: QueryCtx | MutationCtx, machineId: string) {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .unique();
  if (!machine) throw importMachineNotFound();
  return machine;
}

function importMachineNotFound(): ConvexError<{ code: string; message: string }> {
  return new ConvexError({
    code: BACKEND_ERROR_CODES.IMPORT_MACHINE_NOT_FOUND,
    message: 'Machine not found',
  });
}

/**
 * Session → machine existence → owner. Returns the authenticated user so the
 * mutation can pass it to the apply core.
 *
 * Translates only the owner failure; an invalid session or DB error surfaces
 * unchanged, and a missing machine reports `IMPORT_MACHINE_NOT_FOUND`.
 */
async function requireOwnedMachine(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  machineId: string
): Promise<{ userId: Id<'users'> }> {
  const auth = await requireSession(ctx, sessionId);
  await requireMachine(ctx, machineId);
  try {
    await requireMachineOwner(ctx, sessionId, machineId);
  } catch (error) {
    if (errorCodeOf(error) === NOT_AUTHORIZED_MACHINE) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.IMPORT_MACHINE_NOT_OWNED,
        message: 'This machine belongs to another user',
      });
    }
    throw error;
  }
  return auth;
}

async function readAvailableHarnesses(
  ctx: QueryCtx | MutationCtx,
  machineId: string
): Promise<string[]> {
  const capabilities = await ctx.db
    .query('chatroom_machineCapabilities')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  return capabilities?.availableHarnesses ?? [];
}

function isValidWorkingDir(dir: string): boolean {
  try {
    validateWorkingDir(dir);
    return true;
  } catch {
    return false;
  }
}

/** Reads `code` off a `ConvexError`'s `data` payload. */
function errorCodeOf(error: unknown): string | undefined {
  const data = dataOf(error);
  const code =
    typeof data === 'object' && data !== null ? (data as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

function dataOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { data?: unknown }).data
    : undefined;
}
