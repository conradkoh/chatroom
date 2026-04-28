/**
 * Command Sync Heartbeat — discovers and syncs workspace commands to backend.
 *
 * Called during daemon heartbeat alongside git state and file tree pushes.
 * Uses change detection (hash of command list) to skip unchanged syncs.
 */

import { createHash } from 'node:crypto';

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { discoverCommands } from '../../../infrastructure/services/workspace/command-discovery.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/**
 * Discover and sync commands for all tracked workspaces.
 */
export async function pushCommands(ctx: DaemonContext): Promise<void> {
  let workspaces: Array<{ workingDir: string }>;
  try {
    workspaces = await ctx.deps.backend.query(api.workspaces.listWorkspacesForMachine, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to query workspaces for command sync: ${getErrorMessage(err)}`
    );
    return;
  }

  const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));
  if (uniqueWorkingDirs.size === 0) return;

  for (const workingDir of uniqueWorkingDirs) {
    try {
      await pushSingleWorkspaceCommands(ctx, workingDir);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Command sync failed for ${workingDir}: ${getErrorMessage(err)}`
      );
    }
  }
}

export async function pushSingleWorkspaceCommands(
  ctx: DaemonContext,
  workingDir: string
): Promise<void> {
  const commands = await discoverCommands(workingDir);

  // Change detection: hash the command list to skip unchanged syncs
  const stateKey = `commands:${ctx.machineId}::${workingDir}`;
  const commandsHash = createHash('md5').update(JSON.stringify(commands)).digest('hex');

  if (ctx.lastPushedGitState.get(stateKey) === commandsHash) {
    return; // No change
  }

  await ctx.deps.backend.mutation(api.commands.syncCommands, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    commands,
  });

  ctx.lastPushedGitState.set(stateKey, commandsHash);
  console.log(`[${formatTimestamp()}] 📦 Synced ${commands.length} commands for ${workingDir}`);
}
