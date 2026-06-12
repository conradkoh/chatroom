/**
 * Command Sync Heartbeat — discovers and syncs workspace commands to backend.
 *
 * Called during daemon heartbeat alongside git state and file tree pushes.
 * Uses change detection (hash of command list) to skip unchanged syncs.
 */

import { createHash } from 'node:crypto';

import { Effect } from 'effect';

import { DaemonSessionService } from './daemon-services.js';
import type { SessionId, WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';
import { getWorkspacesForMachine } from './workspace-cache.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { discoverCommands } from '../../../infrastructure/services/workspace/command-discovery.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

// ── Minimal dep type used by Core functions + Effect twins ────────────────────

export type CommandSyncDeps = {
  machineId: string;
  sessionId: SessionId;
  backend: BackendOps;
  lastPushedGitState: Map<string, string>;
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number };
};

// ── Core implementations (flat deps, no ctx.deps.xxx) ─────────────────────────

async function pushCommandsCore(ctx: CommandSyncDeps): Promise<void> {
  const workspaces = await getWorkspacesForMachine({
    workspaceListStore: ctx.workspaceListStore,
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    backend: ctx.backend,
  });
  if (workspaces.length === 0) return;

  const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));
  if (uniqueWorkingDirs.size === 0) return;

  for (const workingDir of uniqueWorkingDirs) {
    try {
      await pushSingleWorkspaceCommandsCore(ctx, workingDir);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Command sync failed for ${workingDir}: ${getErrorMessage(err)}`
      );
    }
  }
}

export async function pushSingleWorkspaceCommandsCore(
  ctx: CommandSyncDeps,
  workingDir: string
): Promise<void> {
  const commands = await discoverCommands(workingDir);

  // Change detection: hash the command list to skip unchanged syncs
  const stateKey = `commands:${ctx.machineId}::${workingDir}`;
  const commandsHash = createHash('md5').update(JSON.stringify(commands)).digest('hex');

  if (ctx.lastPushedGitState.get(stateKey) === commandsHash) {
    return; // No change
  }

  await ctx.backend.mutation(api.commands.syncCommands, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    commands,
  });

  ctx.lastPushedGitState.set(stateKey, commandsHash);
  console.log(`[${formatTimestamp()}] 📦 Synced ${commands.length} commands for ${workingDir}`);
}

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin for pushCommands — yields DaemonSessionService; DaemonSessionServiceShape satisfies CommandSyncDeps. */
export const pushCommandsEffect: Effect.Effect<void, never, DaemonSessionService> = Effect.gen(
  function* () {
    const session = yield* DaemonSessionService;
    yield* Effect.promise(() => pushCommandsCore(session));
  }
);

/** Effect twin for pushSingleWorkspaceCommands — yields DaemonSessionService. */
// fallow-ignore-next-line unused-export
export const pushSingleWorkspaceCommandsEffect = (
  workingDir: string
): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    yield* Effect.promise(() => pushSingleWorkspaceCommandsCore(session, workingDir));
  });
