import type { ConvexClient } from 'convex/browser';
import { Effect } from 'effect';
// fallow-ignore-file complexity

import { DaemonSessionService } from './daemon-services.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { syncDirListingToBackend } from '../../../infrastructure/services/workspace/dir-listing-sync.js';
import { createWorkspaceFsWatcher } from '../../../infrastructure/services/workspace/workspace-fs-watcher.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

export interface DirListingWatchSubscriptionHandle {
  stop: () => void;
}

type WatchTarget = {
  workingDir: string;
  activeDirPaths: string[];
};

export const startDirListingWatchSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<DirListingWatchSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const watchers = new Map<string, ReturnType<typeof createWorkspaceFsWatcher>>();

    const applyTargets = (targets: WatchTarget[]) => {
      const nextWorkingDirs = new Set(targets.map((t) => t.workingDir));

      for (const [workingDir, handle] of watchers) {
        if (!nextWorkingDirs.has(workingDir)) {
          handle.stop();
          watchers.delete(workingDir);
        }
      }

      for (const target of targets) {
        const activeSet = new Set(target.activeDirPaths);
        const existing = watchers.get(target.workingDir);
        if (existing) {
          existing.updateActiveDirPaths(activeSet);
          continue;
        }

        const handle = createWorkspaceFsWatcher({
          workingDir: target.workingDir,
          activeDirPaths: activeSet,
          onRefreshDirs: async (dirPaths) => {
            for (const dirPath of dirPaths) {
              try {
                await syncDirListingToBackend(session, target.workingDir, dirPath);
              } catch (err) {
                console.warn(
                  `[${formatTimestamp()}] ⚠️  FS watch sync failed for ${target.workingDir}/${dirPath || '(root)'}: ${getErrorMessage(err)}`
                );
              }
            }
          },
        });
        watchers.set(target.workingDir, handle);
      }
    };

    let stopped = false;
    const unsub = wsClient.onUpdate(
      api.workspaceFiles.listDirListingWatchTargets,
      { sessionId: session.sessionId, machineId: session.machineId },
      (targets) => {
        if (stopped) return;
        applyTargets(targets ?? []);
      },
      (err) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Dir listing watch subscription error: ${getErrorMessage(err)}`
        );
      }
    );

    console.log(`[${formatTimestamp()}] 👁️  Dir listing FS watch subscription started`);

    return {
      stop: () => {
        stopped = true;
        unsub();
        for (const handle of watchers.values()) handle.stop();
        watchers.clear();
        console.log(`[${formatTimestamp()}] 👁️  Dir listing FS watch subscription stopped`);
      },
    };
  });
