/**
 * Observed Sync Subscription — event-driven subscription to chatrooms the frontend is actively observing.
 *
 * Uses Convex reactive subscription (wsClient.onUpdate) to get notified when the observed set changes.
 * Maintains a Map of observed working dirs with per-workingDir state:
 * - newly observed workingDir → push immediately + start per-workingDir safety poll
 * - no-longer-observed → clearInterval + cleanup
 * - still observed → no-op
 *
 * TTL reconcile: a periodic local timer re-runs handleObservedChange so stale observations
 * (whose TTL expired while the browser tab was closed) are cleaned up even if Convex does
 * not re-deliver the onUpdate callback solely due to Date.now() crossing the TTL boundary.
 */

import {
  OBSERVED_SAFETY_POLL_MS,
  OBSERVATION_TTL_MS,
} from '@workspace/backend/config/reliability.js';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Layer } from 'effect';

import { pushSingleWorkspaceCommandsEffect } from './command-sync-heartbeat.js';
import { DaemonMutableStateServiceLive, DaemonSessionService } from './daemon-services.js';
import { pushSingleWorkspaceGitSummaryForObservedEffect } from './git-heartbeat.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type ObservedChatrooms = FunctionReturnType<typeof api.machines.getObservedChatroomsForMachine>;

interface ObservedWorkingDirState {
  intervalHandle: ReturnType<typeof setInterval>;
  /** True while a pushForWorkingDir call is already in flight — prevents overlapping pushes. */
  pushInFlight: boolean;
}

/** Tracks the last seen lastRefreshedAt per chatroomId to detect refresh signals. */
interface ChatroomRefreshState {
  lastRefreshedAt: number | null;
}

export const startObservedSyncSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<{ stop: () => void }, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    console.log(`[${formatTimestamp()}] 👁️ Starting observed-sync subscription (reactive)`);

    const observedWorkingDirs = new Map<string, ObservedWorkingDirState>();
    const chatroomRefreshState = new Map<string, ChatroomRefreshState>();
    const skippedPushCount = new Map<string, number>();
    const pendingRefresh = new Map<string, boolean>();

    let stopped = false;
    let reconcileInFlight = false;

    const unsubscribe = wsClient.onUpdate(
      api.machines.getObservedChatroomsForMachine,
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      },
      (observed) => {
        if (stopped) return;
        handleObservedChange(observed ?? []);
      },
      (err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️ Observed-sync subscription error: ${getErrorMessage(err)}`
        );
      }
    );

    const reconcileIntervalMs = Math.max(OBSERVATION_TTL_MS / 2, OBSERVED_SAFETY_POLL_MS);
    const reconcileTimer = setInterval(() => {
      if (stopped || reconcileInFlight) return;
      reconcileInFlight = true;
      session.backend
        .query(api.machines.getObservedChatroomsForMachine, {
          sessionId: session.sessionId,
          machineId: session.machineId,
        })
        .then((observed) => {
          if (!stopped) handleObservedChange(observed ?? []);
        })
        .catch((err: unknown) => {
          console.warn(
            `[${formatTimestamp()}] ⚠️ Observed-sync reconcile query failed: ${getErrorMessage(err)}`
          );
        })
        .finally(() => {
          reconcileInFlight = false;
        });
    }, reconcileIntervalMs);

    console.log(`[${formatTimestamp()}] 👁️ Observed-sync subscription started`);

    return {
      stop: () => {
        stopped = true;
        unsubscribe();
        clearInterval(reconcileTimer);
        for (const [wd, state] of observedWorkingDirs) {
          clearInterval(state.intervalHandle);
          const skips = skippedPushCount.get(wd) ?? 0;
          if (skips > 0) {
            console.log(
              `[${formatTimestamp()}] 👁️ Stopped observing ${wd} (skipped ${skips} overlapping pushes)`
            );
          } else {
            console.log(`[${formatTimestamp()}] 👁️ Stopped observing ${wd}`);
          }
        }
        observedWorkingDirs.clear();
        skippedPushCount.clear();
        pendingRefresh.clear();
        console.log(`[${formatTimestamp()}] 👁️ Observed-sync subscription stopped`);
      },
    };

    function handleObservedChange(observed: ObservedChatrooms): void {
      const newWorkingDirs = new Set<string>();
      const refreshedWorkingDirs = new Set<string>();

      for (const chatroom of observed) {
        const chatroomId = chatroom.chatroomId;
        const currentRefresh = chatroom.lastRefreshedAt;
        const previous = chatroomRefreshState.get(chatroomId);

        const wasRefreshed =
          currentRefresh !== null &&
          currentRefresh !== undefined &&
          (previous === undefined || (previous.lastRefreshedAt ?? 0) < currentRefresh);

        if (wasRefreshed) {
          chatroomRefreshState.set(chatroomId, { lastRefreshedAt: currentRefresh });
          for (const wd of chatroom.workingDirs) {
            refreshedWorkingDirs.add(wd);
          }
        }

        for (const wd of chatroom.workingDirs) {
          newWorkingDirs.add(wd);
        }
      }

      for (const [chatroomId] of chatroomRefreshState) {
        const stillObserved = observed.some((c) => c.chatroomId === chatroomId);
        if (!stillObserved) {
          chatroomRefreshState.delete(chatroomId);
        }
      }

      const currentWorkingDirs = new Set(observedWorkingDirs.keys());
      let addedCount = 0;
      let removedCount = 0;

      for (const wd of currentWorkingDirs) {
        if (!newWorkingDirs.has(wd)) {
          const state = observedWorkingDirs.get(wd);
          if (state) {
            clearInterval(state.intervalHandle);
            observedWorkingDirs.delete(wd);
            const skips = skippedPushCount.get(wd) ?? 0;
            if (skips > 0) {
              console.log(
                `[${formatTimestamp()}] 👁️ Stopped observing ${wd} (skipped ${skips} overlapping pushes)`
              );
            } else {
              console.log(`[${formatTimestamp()}] 👁️ Stopped observing ${wd}`);
            }
            skippedPushCount.delete(wd);
            pendingRefresh.delete(wd);
            removedCount++;
          }
        }
      }

      for (const wd of newWorkingDirs) {
        if (!observedWorkingDirs.has(wd)) {
          observedWorkingDirs.set(wd, {
            intervalHandle: setInterval(() => {
              schedulePushForWorkingDir(wd, 'safety-poll');
            }, OBSERVED_SAFETY_POLL_MS),
            pushInFlight: false,
          });
          console.log(`[${formatTimestamp()}] 👁️ Started observing ${wd}`);
          schedulePushForWorkingDir(wd, 'safety-poll');
          addedCount++;
        }
      }

      if (addedCount > 0 || removedCount > 0) {
        console.log(
          `[${formatTimestamp()}] 👁️ Observing ${observedWorkingDirs.size} working dir(s)`
        );
      }

      for (const wd of refreshedWorkingDirs) {
        if (observedWorkingDirs.has(wd)) {
          console.log(`[${formatTimestamp()}] 🔄 Refresh triggered for ${wd}`);
          schedulePushForWorkingDir(wd, 'refresh');
        }
      }
    }

    function schedulePushForWorkingDir(
      workingDir: string,
      reason: 'safety-poll' | 'refresh' = 'safety-poll'
    ): void {
      if (stopped) return;
      const state = observedWorkingDirs.get(workingDir);
      if (!state) return;

      if (state.pushInFlight) {
        if (reason === 'refresh') {
          pendingRefresh.set(workingDir, true);
        }
        const current = skippedPushCount.get(workingDir) ?? 0;
        skippedPushCount.set(workingDir, current + 1);
        console.log(
          `[${formatTimestamp()}] 👁️ Skipping observed push for ${workingDir} (${reason}, in flight)`
        );
        return;
      }

      state.pushInFlight = true;
      pushForWorkingDir(workingDir, reason)
        .catch((err: unknown) => {
          console.warn(
            `[${formatTimestamp()}] ⚠️ Push failed for ${workingDir}: ${getErrorMessage(err)}`
          );
        })
        .finally(() => {
          const s = observedWorkingDirs.get(workingDir);
          if (s) {
            s.pushInFlight = false;
            if (pendingRefresh.get(workingDir)) {
              pendingRefresh.delete(workingDir);
              schedulePushForWorkingDir(workingDir, 'refresh');
            }
          }
        });
    }

    async function pushForWorkingDir(
      workingDir: string,
      reason: 'safety-poll' | 'refresh' = 'safety-poll'
    ): Promise<void> {
      await Effect.runPromise(
        pushSingleWorkspaceGitSummaryForObservedEffect(workingDir, reason).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(DaemonSessionService, session),
              DaemonMutableStateServiceLive({
                lastPushedGitState: session.lastPushedGitState,
                lastPushedModels: session.lastPushedModels,
                lastPushedHarnessFingerprint: session.lastPushedHarnessFingerprint,
                workspaceListStore: session.workspaceListStore,
              })
            )
          )
        )
      ).catch((err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️ Observed git summary push failed for ${workingDir}: ${getErrorMessage(err)}`
        );
      });
      await Effect.runPromise(
        pushSingleWorkspaceCommandsEffect(workingDir).pipe(
          Effect.provideService(DaemonSessionService, session)
        )
      ).catch((err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️ Command sync failed for ${workingDir}: ${getErrorMessage(err)}`
        );
      });
    }
  });
