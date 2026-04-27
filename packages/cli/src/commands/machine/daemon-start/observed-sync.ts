/**
 * Observed Sync Subscription — event-driven subscription to chatrooms the frontend is actively observing.
 *
 * Uses Convex reactive subscription (wsClient.onUpdate) to get notified when the observed set changes.
 * Maintains a Map of observed working dirs with per-workingDir state:
 * - newly observed workingDir → push immediately + start per-workingDir safety poll
 * - no-longer-observed → clearInterval + cleanup
 * - still observed → no-op
 */

import type { FunctionReturnType } from 'convex/server';
import type { ConvexClient } from 'convex/browser';

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { OBSERVED_SAFETY_POLL_MS } from '@workspace/backend/config/reliability.js';
import { pushSingleWorkspaceGitState } from './git-heartbeat.js';
import { pushSingleWorkspaceCommands } from './command-sync-heartbeat.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type ObservedChatrooms = FunctionReturnType<typeof api.machines.getObservedChatroomsForMachine>;
type ObservedChatroom = ObservedChatrooms[number];

interface ObservedWorkingDirState {
  intervalHandle: ReturnType<typeof setInterval>;
  observingChatroomIds: Set<string>;
}

export function startObservedSyncSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient
): { stop: () => void } {
  console.log(`[${formatTimestamp()}] 👁️ Starting observed-sync subscription (reactive)`);

  const observedWorkingDirs = new Map<string, ObservedWorkingDirState>();

  const unsubscribe = wsClient.onUpdate(
    api.machines.getObservedChatroomsForMachine,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    (observed) => {
      handleObservedChange(observed ?? []);
    },
    (err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Observed-sync subscription error: ${getErrorMessage(err)}`
      );
    }
  );

  console.log(`[${formatTimestamp()}] 👁️ Observed-sync subscription started`);

  return {
    stop: () => {
      unsubscribe();
      for (const [_, state] of observedWorkingDirs) {
        clearInterval(state.intervalHandle);
      }
      observedWorkingDirs.clear();
      console.log(`[${formatTimestamp()}] 👁️ Observed-sync subscription stopped`);
    },
  };

  function handleObservedChange(observed: ObservedChatrooms): void {
    const newWorkingDirs = new Set<string>();
    const chatroomWorkingDirs = new Map<string, Set<string>>();

    for (const chatroom of observed) {
      const chatroomId = chatroom.chatroomId;
      for (const wd of chatroom.workingDirs) {
        newWorkingDirs.add(wd);
        const existing = chatroomWorkingDirs.get(wd) ?? new Set();
        existing.add(chatroomId);
        chatroomWorkingDirs.set(wd, existing);
      }
    }

    const currentWorkingDirs = new Set(observedWorkingDirs.keys());

    for (const wd of currentWorkingDirs) {
      if (!newWorkingDirs.has(wd)) {
        const state = observedWorkingDirs.get(wd);
        if (state) {
          clearInterval(state.intervalHandle);
          observedWorkingDirs.delete(wd);
          console.log(`[${formatTimestamp()}] 👁️ Stopped observing ${wd}`);
        }
      }
    }

    for (const wd of newWorkingDirs) {
      if (!observedWorkingDirs.has(wd)) {
        const observingChatroomIds = chatroomWorkingDirs.get(wd) ?? new Set();
        observedWorkingDirs.set(wd, {
          intervalHandle: setInterval(() => {
            pushForWorkingDir(wd).catch((err: unknown) => {
              console.warn(
                `[${formatTimestamp()}] ⚠️ Safety poll failed for ${wd}: ${getErrorMessage(err)}`
              );
            });
          }, OBSERVED_SAFETY_POLL_MS),
          observingChatroomIds,
        });
        console.log(`[${formatTimestamp()}] 👁️ Started observing ${wd}`);
        pushForWorkingDir(wd).catch((err: unknown) => {
          console.warn(
            `[${formatTimestamp()}] ⚠️ Initial push failed for ${wd}: ${getErrorMessage(err)}`
          );
        });
      } else {
        const state = observedWorkingDirs.get(wd);
        if (state) {
          state.observingChatroomIds = chatroomWorkingDirs.get(wd) ?? new Set();
        }
      }
    }
  }

  async function pushForWorkingDir(workingDir: string): Promise<void> {
    await pushSingleWorkspaceGitState(ctx, workingDir).catch((err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Git state push failed for ${workingDir}: ${getErrorMessage(err)}`
      );
    });
    await pushSingleWorkspaceCommands(ctx, workingDir).catch((err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Command sync failed for ${workingDir}: ${getErrorMessage(err)}`
      );
    });
  }
}
