/**
 * Command Sync Heartbeat — discovers and syncs workspace commands to backend.
 *
 * Called during daemon heartbeat alongside git state and file tree pushes.
 * Uses change detection (hash of command list) to skip unchanged syncs.
 */

import { createHash } from 'node:crypto';

import { Effect } from 'effect';

import { DaemonContextService } from './daemon-context-service.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { getWorkspacesForMachine } from './workspace-cache.js';
import { api } from '../../../api.js';
import { discoverCommands } from '../../../infrastructure/services/workspace/command-discovery.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/**
 * Discover and sync commands for all tracked workspaces.
 */
export async function pushCommands(ctx: DaemonContext): Promise<void> {
  const workspaces = await getWorkspacesForMachine(ctx);
  if (workspaces.length === 0) return;

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

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin for pushCommands — yields DaemonContextService and delegates. */
// fallow-ignore-next-line unused-export
export const pushCommandsEffect: Effect.Effect<void, never, DaemonContextService> = Effect.gen(
  function* () {
    const ctx = yield* DaemonContextService;
    yield* Effect.promise(() => pushCommands(ctx));
  }
);

/** Effect twin for pushSingleWorkspaceCommands — yields DaemonContextService and delegates. */
// fallow-ignore-next-line unused-export
export const pushSingleWorkspaceCommandsEffect = (
  workingDir: string
): Effect.Effect<void, never, DaemonContextService> =>
  Effect.gen(function* () {
    const ctx = yield* DaemonContextService;
    yield* Effect.promise(() => pushSingleWorkspaceCommands(ctx, workingDir));
  });
