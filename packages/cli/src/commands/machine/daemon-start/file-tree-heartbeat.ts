/**
 * File Tree Heartbeat — scans and pushes file tree for all tracked workspaces.
 *
 * Called on daemon heartbeat alongside git state push.
 * Uses change detection (hash of tree JSON) to skip unchanged state.
 */

import { createHash } from 'node:crypto';

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { scanFileTree } from '../../../infrastructure/services/workspace/file-tree-scanner.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/**
 * Scan file trees for all tracked workspaces and push to backend.
 *
 * Similar to pushGitState — queries workspaces, scans each, pushes changes.
 */
export async function pushFileTree(ctx: DaemonContext): Promise<void> {
  let workspaces: Array<{ workingDir: string }>;
  try {
    workspaces = await ctx.deps.backend.query(api.workspaces.listWorkspacesForMachine, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to query workspaces for file tree sync: ${getErrorMessage(err)}`
    );
    return;
  }

  const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));
  if (uniqueWorkingDirs.size === 0) return;

  for (const workingDir of uniqueWorkingDirs) {
    try {
      await pushSingleWorkspaceFileTree(ctx, workingDir);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  File tree push failed for ${workingDir}: ${getErrorMessage(err)}`
      );
    }
  }
}

async function pushSingleWorkspaceFileTree(
  ctx: DaemonContext,
  workingDir: string
): Promise<void> {
  const tree = await scanFileTree(workingDir);
  const treeJson = JSON.stringify(tree);

  // Change detection: hash the tree JSON to skip unchanged pushes
  const stateKey = `filetree:${ctx.machineId}::${workingDir}`;
  const treeHash = createHash('md5').update(treeJson).digest('hex');

  if (ctx.lastPushedGitState.get(stateKey) === treeHash) {
    return; // No change — skip push
  }

  await ctx.deps.backend.mutation(api.workspaceFiles.syncFileTree, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    treeJson,
    scannedAt: tree.scannedAt,
  });

  ctx.lastPushedGitState.set(stateKey, treeHash);
  console.log(
    `[${formatTimestamp()}] 📁 File tree pushed: ${workingDir} (${tree.entries.length} entries)`
  );
}
