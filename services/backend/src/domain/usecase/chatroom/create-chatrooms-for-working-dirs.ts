/**
 * Use Case: Create Chatrooms For Working Dirs
 *
 * Bulk variant of createChatroomWithWorkspace: one chatroom per working directory, in one
 * mutation transaction. Each unique directory is created through createChatroomWithWorkspace
 * (the only creation path), skipped when the caller already has an active chatroom for it, or
 * failed when the path is invalid. No agent is started.
 *
 * Idempotent: a repeated call finds every directory owned and writes nothing. Only input
 * validation is caught per item, and it runs before any write. Any other throw propagates and
 * aborts the whole transaction, so a retry starts from the same state.
 */

import { ConvexError } from 'convex/values';

import { createChatroomWithWorkspace } from './create-chatroom-with-workspace';
import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';
import { BULK_CREATE_MAX_REPOSITORIES } from '../../entities/repository-ledger';
import { DEFAULT_TEAM_PRESET_ID } from '../../entities/team-presets';
import { findActiveChatroomForWorkingDir } from '../workspace/find-active-chatroom-for-working-dir';

export type BulkCreateOutcome =
  | {
      workingDir: string;
      outcome: 'created';
      chatroomId: Id<'chatroom_rooms'>;
      workspaceId: Id<'chatroom_workspaces'>;
    }
  | {
      workingDir: string;
      outcome: 'skipped';
      reason: 'already_has_chatroom';
      chatroomId: Id<'chatroom_rooms'>;
    }
  | { workingDir: string; outcome: 'failed'; code: 'INVALID_WORKING_DIR'; message: string };

export interface BulkCreateResult {
  results: BulkCreateOutcome[];
  created: number;
  skipped: number;
  failed: number;
}

export interface CreateChatroomsForWorkingDirsInput {
  ownerId: Id<'users'>;
  machineId: string;
  workingDirs: string[];
}

/** True when ConvexError data carries the human-readable message. */
function hasStringMessage(data: unknown): data is { message: string } {
  const message = (data as { message?: unknown } | null)?.message;
  return typeof message === 'string';
}

/** Message for a per-item INVALID_WORKING_DIR. ConvexError data carries the message; plain Errors carry it directly. */
function messageFromInvalidWorkingDir(err: unknown): string {
  if (err instanceof ConvexError && hasStringMessage(err.data)) return err.data.message;
  return err instanceof Error ? err.message : 'Invalid working directory';
}

/**
 * A working dir after validation. `key` is the dedupe key for this call: the normalized path, or
 * `invalid:<raw>` so repeated invalid raw strings produce one failed item.
 */
type NormalizedDir =
  | { ok: true; key: string; workingDir: string }
  | { ok: false; key: string; rawDir: string; message: string };

function normalizeDir(rawDir: string): NormalizedDir {
  try {
    const workingDir = normalizeWorkingDir(rawDir);
    return { ok: true, key: workingDir, workingDir };
  } catch (err) {
    return {
      ok: false,
      key: `invalid:${rawDir}`,
      rawDir,
      message: messageFromInvalidWorkingDir(err),
    };
  }
}

/** The machine row for this id. Missing machines fail before any chatroom write. */
async function requireMachineRow(ctx: MutationCtx, machineId: string) {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (machine) return machine;
  throw new ConvexError({
    code: BACKEND_ERROR_CODES.MACHINE_NOT_FOUND,
    message: 'Machine not found',
  });
}

async function assertCanBulkCreate(
  ctx: MutationCtx,
  input: CreateChatroomsForWorkingDirsInput
): Promise<void> {
  if (input.workingDirs.length > BULK_CREATE_MAX_REPOSITORIES) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.BULK_CREATE_LIMIT_EXCEEDED,
      message: `At most ${BULK_CREATE_MAX_REPOSITORIES} repositories can be created per call`,
    });
  }
  await requireMachineRow(ctx, input.machineId);
}

/** Creates the chatroom, or reports the caller's existing one. Both checks run before any write. */
async function resolveChatroomOutcome(
  ctx: MutationCtx,
  input: CreateChatroomsForWorkingDirsInput,
  workingDir: string
): Promise<BulkCreateOutcome> {
  const existing = await findActiveChatroomForWorkingDir(ctx, {
    ownerId: input.ownerId,
    machineId: input.machineId,
    workingDir,
  });
  if (existing) {
    return {
      workingDir,
      outcome: 'skipped',
      reason: 'already_has_chatroom',
      chatroomId: existing.chatroomId,
    };
  }

  const created = await createChatroomWithWorkspace(ctx, {
    ownerId: input.ownerId,
    teamStructureId: DEFAULT_TEAM_PRESET_ID,
    machineId: input.machineId,
    workingDir,
  });
  return {
    workingDir,
    outcome: 'created',
    chatroomId: created.chatroomId,
    workspaceId: created.workspaceId,
  };
}

/** One input item's outcome, or null when this call already covered the directory. */
async function processDir(
  ctx: MutationCtx,
  input: CreateChatroomsForWorkingDirsInput,
  rawDir: string,
  seen: Set<string>
): Promise<BulkCreateOutcome | null> {
  const dir = normalizeDir(rawDir);
  if (seen.has(dir.key)) return null;
  seen.add(dir.key);
  if (!dir.ok) {
    return {
      workingDir: dir.rawDir,
      outcome: 'failed',
      code: 'INVALID_WORKING_DIR',
      message: dir.message,
    };
  }
  return resolveChatroomOutcome(ctx, input, dir.workingDir);
}

function summarize(results: BulkCreateOutcome[]): BulkCreateResult {
  const count = (outcome: BulkCreateOutcome['outcome']) =>
    results.filter((r) => r.outcome === outcome).length;
  return { results, created: count('created'), skipped: count('skipped'), failed: count('failed') };
}

export async function createChatroomsForWorkingDirs(
  ctx: MutationCtx,
  input: CreateChatroomsForWorkingDirsInput
): Promise<BulkCreateResult> {
  // Everything below runs in one transaction: validation first, then per-item writes.
  await assertCanBulkCreate(ctx, input);

  const results: BulkCreateOutcome[] = [];
  const seen = new Set<string>();
  for (const rawDir of input.workingDirs) {
    const result = await processDir(ctx, input, rawDir, seen);
    if (result) results.push(result);
  }

  return summarize(results);
}
