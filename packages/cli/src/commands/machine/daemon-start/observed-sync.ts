/**
 * Observed Sync Subscription — event-driven subscription to chatrooms the frontend is actively observing.
 *
 * Uses Convex reactive subscription (wsClient.onUpdate) to get notified when the observed set changes.
 * Maintains a Map of observed working dirs with per-workingDir state:
 * - newly observed workingDir → push immediately + start per-workingDir safety poll
 * - no-longer-observed → clearInterval + cleanup
 * - still observed → no-op
 *
 * TTL reconcile: a slow fallback timer re-runs handleObservedChange so stale observations
 * (whose TTL expired while the browser tab was closed) are cleaned up even if Convex does
 * not re-deliver the onUpdate callback solely due to Date.now() crossing the TTL boundary.
 */

import {
  OBSERVED_SAFETY_POLL_MS,
  OBSERVED_SYNC_RECONCILE_MS,
} from '@workspace/backend/config/reliability.js';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Runtime } from 'effect';

import { pushSingleWorkspaceCommandsEffect } from './command-sync-heartbeat.js';
import type { DaemonMutableStateService } from './daemon-services.js';
import { DaemonSessionService } from './daemon-services.js';
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
): Effect.Effect<{ stop: () => void }, never, DaemonSessionService | DaemonMutableStateService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const effectContext = yield* Effect.context<DaemonSessionService | DaemonMutableStateService>();
    const runtime = yield* Effect.runtime<DaemonSessionService | DaemonMutableStateService>();

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

    const reconcileIntervalMs = OBSERVED_SYNC_RECONCILE_MS;
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

    function collectWorkingDirChanges(observed: ObservedChatrooms): {
      newWorkingDirs: Set<string>;
      refreshedWorkingDirs: Set<string>;
    } {
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

      return { newWorkingDirs, refreshedWorkingDirs };
    }

    function pruneStaleChatroomRefreshState(observed: ObservedChatrooms): void {
      for (const [chatroomId] of chatroomRefreshState) {
        const stillObserved = observed.some((c) => c.chatroomId === chatroomId);
        if (!stillObserved) {
          chatroomRefreshState.delete(chatroomId);
        }
      }
    }

    function removeUnobservedWorkingDirs(newWorkingDirs: Set<string>): number {
      const currentWorkingDirs = new Set(observedWorkingDirs.keys());
      let removedCount = 0;

      for (const wd of currentWorkingDirs) {
        if (newWorkingDirs.has(wd)) {
          continue;
        }
        const state = observedWorkingDirs.get(wd);
        if (!state) {
          continue;
        }
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

      return removedCount;
    }

    function addNewlyObservedWorkingDirs(newWorkingDirs: Set<string>): number {
      let addedCount = 0;

      for (const wd of newWorkingDirs) {
        if (observedWorkingDirs.has(wd)) {
          continue;
        }
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

      return addedCount;
    }

    function triggerRefreshedWorkingDirs(refreshedWorkingDirs: Set<string>): void {
      for (const wd of refreshedWorkingDirs) {
        if (!observedWorkingDirs.has(wd)) {
          continue;
        }
        console.log(`[${formatTimestamp()}] 🔄 Refresh triggered for ${wd}`);
        schedulePushForWorkingDir(wd, 'refresh');
      }
    }

    function handleObservedChange(observed: ObservedChatrooms): void {
      const { newWorkingDirs, refreshedWorkingDirs } = collectWorkingDirChanges(observed);
      pruneStaleChatroomRefreshState(observed);

      const removedCount = removeUnobservedWorkingDirs(newWorkingDirs);
      const addedCount = addNewlyObservedWorkingDirs(newWorkingDirs);

      if (addedCount > 0 || removedCount > 0) {
        console.log(
          `[${formatTimestamp()}] 👁️ Observing ${observedWorkingDirs.size} working dir(s)`
        );
      }

      triggerRefreshedWorkingDirs(refreshedWorkingDirs);
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
      pushForWorkingDir(workingDir, reason);
    }

    function pushForWorkingDir(
      workingDir: string,
      reason: 'safety-poll' | 'refresh' = 'safety-poll'
    ): void {
      Runtime.runFork(runtime)(
        Effect.all(
          [
            pushSingleWorkspaceGitSummaryForObservedEffect(workingDir, reason),
            pushSingleWorkspaceCommandsEffect(workingDir),
          ],
          { concurrency: 'unbounded' }
        ).pipe(
          Effect.provide(effectContext),
          Effect.catchAll((err) =>
            Effect.sync(() =>
              console.warn(
                `[${formatTimestamp()}] ⚠️ Observed sync failed for ${workingDir}: ${getErrorMessage(err)}`
              )
            )
          ),
          Effect.ensuring(
            Effect.sync(() => {
              const s = observedWorkingDirs.get(workingDir);
              if (s) {
                s.pushInFlight = false;
                if (pendingRefresh.get(workingDir)) {
                  pendingRefresh.delete(workingDir);
                  schedulePushForWorkingDir(workingDir, 'refresh');
                }
              }
            })
          )
        )
      );
    }
  });
