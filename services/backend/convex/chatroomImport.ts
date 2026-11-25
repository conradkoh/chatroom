/**
 * Chatroom import — Convex queries.
 *
 * `preflight` is the only read the import needs from the target deployment: the
 * machine's identity and harnesses, whether the file's team structure exists
 * here, and which working directories this machine would reject. The CLI calls
 * it before building a plan; nothing here writes (P6 has no mutations).
 *
 * Auth order is session → machine row → machine owner. The machine row must exist
 * before the owner check so an unknown machine reports `IMPORT_MACHINE_NOT_FOUND`
 * rather than the generic auth code, and an owned-by-someone-else machine reports
 * `IMPORT_MACHINE_NOT_OWNED` rather than leaking through `NOT_AUTHORIZED_MACHINE`.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { requireSession } from './auth/session';
import { validateWorkingDir } from './workspacePathSecurity';
import { getTeamPreset } from '../src/domain/entities/team-presets';

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

async function requireMachine(ctx: QueryCtx, machineId: string) {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!machine) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.IMPORT_MACHINE_NOT_FOUND,
      message: 'Machine not found',
    });
  }
  return machine;
}

/** Translates only the owner failure; an invalid session or DB error surfaces unchanged. */
async function requireOwnedMachine(
  ctx: QueryCtx,
  sessionId: string,
  machineId: string
): Promise<void> {
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
}

async function readAvailableHarnesses(ctx: QueryCtx, machineId: string): Promise<string[]> {
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
