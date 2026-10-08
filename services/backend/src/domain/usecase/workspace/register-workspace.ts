/**
 * Use Case: Register Workspace
 *
 * Upserts a workspace registration for a (chatroomId, machineId, workingDir) triple.
 *
 * Behavior:
 *   - If no record exists → insert a new active workspace, enqueue daemon.gitRefresh
 *   - If a record exists and is active → no-op (return existing ID), enqueue nothing
 *   - If a record exists and is removed → reactivate it (clear removedAt), enqueue daemon.gitRefresh
 *
 * Constraint: the active no-op branch must never enqueue. `registerWorkspace` runs on
 * every agent start (daemon `start-agent.ts`), so enqueueing there would add a git
 * refresh per start.
 *
 * Returns the workspace document ID.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';
import type { WorkspaceRegistration } from '../../entities/workspace';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RegisterWorkspaceInput = WorkspaceRegistration;

export type RegisterWorkspaceResult = Id<'chatroom_workspaces'>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Enqueue a `daemon.gitRefresh` so the daemon pushes git state for a workspace
 * immediately after it is registered or reactivated, instead of waiting for the
 * first handoff-to-user.
 *
 * Failures are logged and swallowed (mirrors the handoff-to-user path) so a
 * failed enqueue never rolls back the registration itself.
 */
async function enqueueGitRefresh(ctx: MutationCtx, machineId: string, workingDir: string) {
  try {
    await enqueueMachineCommand(ctx, {
      machineId,
      now: Date.now(),
      command: { type: 'daemon.gitRefresh', workingDir },
    });
  } catch (err) {
    console.warn(`[registerWorkspace] Failed to enqueue git refresh for ${workingDir}:`, err);
  }
}

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function registerWorkspace(
  ctx: MutationCtx,
  input: RegisterWorkspaceInput
): Promise<RegisterWorkspaceResult> {
  const { chatroomId, machineId, workingDir, hostname, registeredBy } = input;
  const normalizedWorkingDir = normalizeWorkingDir(workingDir);

  // Look up existing workspace by the unique triple
  const existing = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom_machine_workingDir', (q) =>
      q
        .eq('chatroomId', chatroomId as Id<'chatroom_rooms'>)
        .eq('machineId', machineId)
        .eq('workingDir', normalizedWorkingDir)
    )
    .first();

  if (existing) {
    if (existing.removedAt !== undefined) {
      // Reactivate soft-deleted workspace
      await ctx.db.patch('chatroom_workspaces', existing._id, {
        removedAt: undefined,
        hostname,
        registeredBy,
        registeredAt: Date.now(),
      });
      await enqueueGitRefresh(ctx, machineId, normalizedWorkingDir);
    }
    // If active, no-op — return existing ID (must NOT enqueue: would re-sync on every agent start)
    return existing._id;
  }

  // Insert new workspace record
  const id = await ctx.db.insert('chatroom_workspaces', {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    machineId,
    workingDir: normalizedWorkingDir,
    hostname,
    registeredBy,
    registeredAt: Date.now(),
    fileTreeSyncEnabled: false,
  });
  await enqueueGitRefresh(ctx, machineId, normalizedWorkingDir);
  return id;
}
