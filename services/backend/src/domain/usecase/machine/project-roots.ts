/**
 * Project roots — machine-scoped user intent.
 *
 * A machine's project roots are the directories it has opted into scanning. Rules
 * (all enforced here because Convex mutations are serializable, so check-then-write
 * is race-free):
 *
 * - Paths are normalized by `normalizeProjectRoot` (absolute, no shell metacharacters,
 *   no empty/`.`/`..` segments, no filesystem root).
 * - Paths are compared exactly (case-sensitive; see `isSameOrNestedPath`).
 * - An exact duplicate is `PROJECT_ROOT_DUPLICATE`; a root inside an existing root is
 *   `PROJECT_ROOT_NESTED`; a root that contains existing roots replaces them
 *   (`collapsedPaths`) in the same transaction.
 * - At most `MAX_PROJECT_ROOTS` rows per machine (`PROJECT_ROOT_LIMIT_REACHED`).
 *
 * Every accepted change (and only an accepted change) calls `enqueueProjectRootsSync`,
 * which coalesces into at most one pending `daemon.syncProjectRoots` command. The
 * daemon then reads `api.machineProjectRoots.list` itself; nothing here pushes paths.
 */

import { ConvexError } from 'convex/values';

import { enqueueMachineCommand } from './enqueue-machine-command';
import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';
import {
  MAX_PROJECT_ROOTS,
  planRootAddition,
  type RootAdditionPlan,
} from '../../entities/project-root';

/** Cap for defensive reads; the invariant keeps the table at `MAX_PROJECT_ROOTS` rows. */
const PROJECT_ROOTS_READ_LIMIT = 100;
/** Cap for the coalescing scan of pending inbox rows. */
const PENDING_INBOX_SCAN_LIMIT = 50;

function invalidProjectRoot(message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: BACKEND_ERROR_CODES.INVALID_WORKING_DIR, message });
}

/**
 * Canonical project root path.
 *
 * `normalizeWorkingDir` covers trimming, absolute paths, shell metacharacters and the
 * filesystem root, but it throws a plain `Error` for most failures. Every failure is
 * rethrown as `ConvexError INVALID_WORKING_DIR` so clients see one error code.
 * It also leaves `.`, `..` and empty segments intact, which would make the nesting
 * checks compare non-canonical paths — those are rejected here.
 */
export function normalizeProjectRoot(input: string): string {
  const normalized = normalizedWorkingDirOrThrow(input);
  assertNoRelativeSegments(normalized);
  return normalized;
}

/** `normalizeWorkingDir` with every failure funnelled into one error code. */
function normalizedWorkingDirOrThrow(input: string): string {
  try {
    return normalizeWorkingDir(input);
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw invalidProjectRoot(error instanceof Error ? error.message : 'Invalid project root path');
  }
}

/**
 * Reject `.`, `..` and empty segments so two spellings of one directory can never
 * sneak past the duplicate and nesting checks as different strings.
 */
function assertNoRelativeSegments(path: string): void {
  const segments = path.split('/').slice(1);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalidProjectRoot('Project root must not contain empty, "." or ".." path segments');
  }
}

/**
 * Enqueue at most one pending `daemon.syncProjectRoots` per machine.
 *
 * The daemon fetches the roots after receiving the nudge, so a second nudge while one
 * is pending carries no information. Only `pending` rows are scanned; a claimed
 * (`processing`) row already woke the daemon and will be re-nudged on the next change.
 */
export async function enqueueProjectRootsSync(ctx: MutationCtx, machineId: string): Promise<void> {
  const pending = await ctx.db
    .query('chatroom_machineCommandInbox')
    .withIndex('by_machine_status_deadline', (q) =>
      q.eq('machineId', machineId).eq('status', 'pending')
    )
    .take(PENDING_INBOX_SCAN_LIMIT);

  if (pending.some((row) => row.command.type === 'daemon.syncProjectRoots')) return;

  await enqueueMachineCommand(ctx, {
    machineId,
    command: { type: 'daemon.syncProjectRoots' },
  });
}

/**
 * Turn an addition plan into its collapse list, throwing the client-facing error for
 * the two rejected kinds. Runs before any write, so a rejected add leaves no trace.
 */
function collapsePathsOrThrow(plan: RootAdditionPlan, path: string): string[] {
  switch (plan.kind) {
    case 'duplicate':
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.PROJECT_ROOT_DUPLICATE,
        message: `Project root already exists: ${path}`,
      });
    case 'nested_in_existing':
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.PROJECT_ROOT_NESTED,
        message: `Project root is inside existing root: ${plan.parent}`,
      });
    case 'add':
      return plan.collapse;
  }
}

/** Delete the rows the new root replaces. */
async function deleteCollapsedRoots(
  ctx: MutationCtx,
  rows: readonly { _id: Id<'chatroom_machineProjectRoots'>; path: string }[],
  collapsedPaths: readonly string[]
): Promise<void> {
  const collapsed = new Set(collapsedPaths);
  for (const row of rows) {
    if (collapsed.has(row.path)) {
      await ctx.db.delete('chatroom_machineProjectRoots', row._id);
    }
  }
}

/**
 * Add a project root for a machine. Deletes any existing roots the new path contains
 * and enqueues a coalesced sync nudge. Throws before writing when rejected.
 */
export async function addProjectRoot(
  ctx: MutationCtx,
  i: { userId: Id<'users'>; machineId: string; path: string }
): Promise<{
  rootId: Id<'chatroom_machineProjectRoots'>;
  path: string;
  collapsedPaths: string[];
}> {
  const path = normalizeProjectRoot(i.path);

  const rows = await ctx.db
    .query('chatroom_machineProjectRoots')
    .withIndex('by_machineId', (q) => q.eq('machineId', i.machineId))
    .take(PROJECT_ROOTS_READ_LIMIT);

  const plan = planRootAddition(
    rows.map((row) => row.path),
    path
  );
  const collapsedPaths = collapsePathsOrThrow(plan, path);

  if (rows.length - collapsedPaths.length + 1 > MAX_PROJECT_ROOTS) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.PROJECT_ROOT_LIMIT_REACHED,
      message: `Machine already has the maximum of ${MAX_PROJECT_ROOTS} project roots`,
    });
  }

  await deleteCollapsedRoots(ctx, rows, collapsedPaths);

  const rootId = await ctx.db.insert('chatroom_machineProjectRoots', {
    machineId: i.machineId,
    userId: i.userId,
    path,
    addedAt: Date.now(),
  });

  await enqueueProjectRootsSync(ctx, i.machineId);

  return { rootId, path, collapsedPaths };
}

/**
 * Remove a project root. Idempotent and allowed while the machine is offline; a row
 * that does not exist or belongs to another machine is a successful no-op.
 */
export async function removeProjectRoot(
  ctx: MutationCtx,
  i: { machineId: string; rootId: Id<'chatroom_machineProjectRoots'> }
): Promise<{ removed: boolean }> {
  const row = await ctx.db.get('chatroom_machineProjectRoots', i.rootId);
  if (!row || row.machineId !== i.machineId) return { removed: false };

  await ctx.db.delete('chatroom_machineProjectRoots', row._id);
  await enqueueProjectRootsSync(ctx, i.machineId);
  return { removed: true };
}
