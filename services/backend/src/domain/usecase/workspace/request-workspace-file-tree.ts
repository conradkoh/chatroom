/**
 * Use Case: Request Workspace File Tree
 *
 * Creates or updates a pending file-tree request for the daemon to fulfill.
 * Returns whether the tree was already fresh (`cached`), already queued (`pending`),
 * or newly requested (`requested`).
 */
// fallow-ignore-file complexity

import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';

/** Staleness window for ensuring the daemon-side cache is active. */
const FILE_TREE_STALENESS_MS = 10 * 1000;

export type RequestWorkspaceFileTreeInput = {
  machineId: string;
  workingDir: string;
  force?: boolean | undefined;
};

export type RequestWorkspaceFileTreeResult =
  { status: 'cached' } | { status: 'pending' } | { status: 'requested' };

export async function requestWorkspaceFileTree(
  ctx: MutationCtx,
  input: RequestWorkspaceFileTreeInput
): Promise<RequestWorkspaceFileTreeResult> {
  const workingDir = normalizeWorkingDir(input.workingDir);

  if (!input.force) {
    const existingTree = await ctx.db
      .query('chatroom_workspaceFileTreeV2')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', input.machineId).eq('workingDir', workingDir)
      )
      .first();

    if (existingTree && Date.now() - existingTree.scannedAt < FILE_TREE_STALENESS_MS) {
      return { status: 'cached' };
    }

    const manifestV3 = await ctx.db
      .query('chatroom_workspaceFileTreeManifestV3')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', input.machineId).eq('workingDir', workingDir)
      )
      .first();

    if (
      manifestV3 &&
      manifestV3.complete &&
      Date.now() - manifestV3.scannedAt < FILE_TREE_STALENESS_MS
    ) {
      return { status: 'cached' };
    }
  }

  const existingRequest = await ctx.db
    .query('chatroom_workspaceFileTreeRequests')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', input.machineId).eq('workingDir', workingDir)
    )
    .first();

  const now = Date.now();
  const force = input.force === true;

  if (existingRequest && existingRequest.status === 'pending') {
    // Always bump updatedAt on explicit force so daemon subscribers re-drain stuck pending rows.
    if (force) {
      await ctx.db.patch('chatroom_workspaceFileTreeRequests', existingRequest._id, {
        force: true,
        updatedAt: now,
      });
    }
    return { status: 'pending' };
  }

  if (existingRequest) {
    await ctx.db.patch('chatroom_workspaceFileTreeRequests', existingRequest._id, {
      status: 'pending',
      force,
      requestedAt: now,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('chatroom_workspaceFileTreeRequests', {
      machineId: input.machineId,
      workingDir,
      status: 'pending',
      force,
      requestedAt: now,
      updatedAt: now,
    });
  }

  return { status: 'requested' };
}
