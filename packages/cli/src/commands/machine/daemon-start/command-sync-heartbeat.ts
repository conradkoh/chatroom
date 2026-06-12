/**
 * Command Sync Heartbeat — discovers and syncs workspace commands to backend.
 *
 * Called during daemon heartbeat alongside git state and file tree pushes.
 * Uses change detection (hash of command list) to skip unchanged syncs.
 */

import { createHash } from 'node:crypto';

import { Effect, Ref } from 'effect';

import { DaemonMutableStateService, DaemonSessionService } from './daemon-services.js';
import type { SessionId, WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';
import { getWorkspacesForMachine } from './workspace-cache.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { discoverCommands } from '../../../infrastructure/services/workspace/command-discovery.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

// ── Minimal dep type used by Effect twins ────────────────────

type CommandSyncRequirements = DaemonSessionService | DaemonMutableStateService;

// fallow-ignore-next-line unused-type
export type CommandSyncDeps = {
  machineId: string;
  sessionId: SessionId;
  backend: BackendOps;
  lastPushedGitState: Map<string, string>;
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number };
};

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Discover and sync workspace commands to backend for all workspaces. */
export const pushCommandsEffect: Effect.Effect<void, never, CommandSyncRequirements> = Effect.gen(
  function* () {
    const session = yield* DaemonSessionService;

    const workspaces = yield* Effect.promise(() =>
      getWorkspacesForMachine({
        workspaceListStore: session.workspaceListStore,
        sessionId: session.sessionId,
        machineId: session.machineId,
        backend: session.backend,
      })
    );
    if (workspaces.length === 0) return;

    const uniqueWorkingDirs = new Set(workspaces.map((ws) => ws.workingDir));
    if (uniqueWorkingDirs.size === 0) return;

    for (const workingDir of uniqueWorkingDirs) {
      yield* pushSingleWorkspaceCommandsEffect(workingDir).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.warn(
              `[${formatTimestamp()}] ⚠️ Command sync failed for ${workingDir}: ${getErrorMessage(err)}`
            );
          })
        )
      );
    }
  }
);

/** Effect twin for pushSingleWorkspaceCommands — yields CommandSyncRequirements. */
export const pushSingleWorkspaceCommandsEffect = (
  workingDir: string
): Effect.Effect<void, never, CommandSyncRequirements> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const mutable = yield* DaemonMutableStateService;
    const lastPushedGitState = yield* Ref.get(mutable.lastPushedGitState);

    const commands = yield* Effect.promise(() => discoverCommands(workingDir));

    // Change detection: hash the command list to skip unchanged syncs
    const stateKey = `commands:${session.machineId}::${workingDir}`;
    const commandsHash = createHash('md5').update(JSON.stringify(commands)).digest('hex');

    if (lastPushedGitState.get(stateKey) === commandsHash) {
      return; // No change
    }

    yield* Effect.promise(() =>
      session.backend.mutation(api.commands.syncCommands, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        workingDir,
        commands,
      })
    );

    lastPushedGitState.set(stateKey, commandsHash);
    console.log(`[${formatTimestamp()}] 📦 Synced ${commands.length} commands for ${workingDir}`);
  });
