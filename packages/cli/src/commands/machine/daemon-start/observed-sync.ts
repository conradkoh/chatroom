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

import type { FunctionReturnType } from 'convex/server';
import type { ConvexClient } from 'convex/browser';

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import {
  OBSERVED_SAFETY_POLL_MS,
  OBSERVATION_TTL_MS,
} from '@workspace/backend/config/reliability.js';
import { pushSingleWorkspaceGitState } from './git-heartbeat.js';
import { pushSingleWorkspaceCommands } from './command-sync-heartbeat.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type ObservedChatrooms = FunctionReturnType<typeof api.machines.getObservedChatroomsForMachine>;

interface ObservedWorkingDirState {
  intervalHandle: ReturnType<typeof setInterval>;
  /** True while a pushForWorkingDir call is already in flight — prevents overlapping pushes. */
  pushInFlight: boolean;
}

export function startObservedSyncSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient
): { stop: () => void } {
  console.log(`[${formatTimestamp()}] 👁️ Starting observed-sync subscription (reactive)`);

  const observedWorkingDirs = new Map<string, ObservedWorkingDirState>();

  /** Set to true by stop() to prevent post-shutdown callbacks from restarting state. */
  let stopped = false;

  /** True while a reconcile query is already in flight — prevents overlapping reconciles. */
  let reconcileInFlight = false;

  const unsubscribe = wsClient.onUpdate(
    api.machines.getObservedChatroomsForMachine,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
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

  /**
   * Local reconcile timer: re-queries the backend on each tick so TTL-expired observations
   * are pruned even when Convex does not re-deliver the onUpdate callback after expiry.
   * Fires at half the observation TTL (capped to at least the safety-poll interval).
   */
  const reconcileIntervalMs = Math.max(OBSERVATION_TTL_MS / 2, OBSERVED_SAFETY_POLL_MS);
  const reconcileTimer = setInterval(() => {
    if (stopped || reconcileInFlight) return;
    reconcileInFlight = true;
    ctx.deps.backend
      .query(api.machines.getObservedChatroomsForMachine, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
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
      for (const [_, state] of observedWorkingDirs) {
        clearInterval(state.intervalHandle);
      }
      observedWorkingDirs.clear();
      console.log(`[${formatTimestamp()}] 👁️ Observed-sync subscription stopped`);
    },
  };

  function handleObservedChange(observed: ObservedChatrooms): void {
    const newWorkingDirs = new Set<string>();

    for (const chatroom of observed) {
      for (const wd of chatroom.workingDirs) {
        newWorkingDirs.add(wd);
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
        observedWorkingDirs.set(wd, {
          intervalHandle: setInterval(() => {
            schedulePushForWorkingDir(wd);
          }, OBSERVED_SAFETY_POLL_MS),
          pushInFlight: false,
        });
        console.log(`[${formatTimestamp()}] 👁️ Started observing ${wd}`);
        schedulePushForWorkingDir(wd);
      }
    }
  }

  function schedulePushForWorkingDir(workingDir: string): void {
    if (stopped) return;
    const state = observedWorkingDirs.get(workingDir);
    if (!state) return;

    if (state.pushInFlight) {
      // A push is already running for this workingDir — skip to prevent overlap
      return;
    }

    state.pushInFlight = true;
    pushForWorkingDir(workingDir)
      .catch((err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️ Push failed for ${workingDir}: ${getErrorMessage(err)}`
        );
      })
      .finally(() => {
        const s = observedWorkingDirs.get(workingDir);
        if (s) s.pushInFlight = false;
      });
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
