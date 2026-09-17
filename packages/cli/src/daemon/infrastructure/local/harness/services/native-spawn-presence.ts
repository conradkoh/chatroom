import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';

import type { SpawnResult } from './remote-agent-service.js';
import type { BackendOps } from '../../../../../infrastructure/deps/index.js';
import type { AgentHarness } from '../../../../../infrastructure/machine/types.js';
import {
  buildActivityLifecycleFact,
  type AgentLifecycleFact,
} from '../../../../domain/entities/agent-lifecycle-fact.js';
import { isTeamAgentRole } from '../../../../domain/entities/execution-kind.js';
import type { HarnessActivityEmitter } from '../../../../services/service-interfaces.js';

export const NATIVE_TOKEN_ACTIVITY_THROTTLE_MS = 30_000;

export interface NativeSpawnPresenceContext {
  backend: BackendOps;
  sessionId: string;
  chatroomId: string;
  role: string;
  lifecycleOutbox?: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> } | undefined;
}

export interface WireTokenActivityReportingOpts {
  chatroomId: string;
  role: string;
  spawnResult: Pick<SpawnResult, 'onOutput'>;
  /** Defaults to Date.now — APM passes clock.now for testability */
  now?: (() => number) | undefined;
  throttleMs?: number | undefined;
  /** Optional typed activity emitter. When present, uses one unthrottled subscription instead of raw onOutput. */
  activityEmitter?: HarnessActivityEmitter | undefined;
  /**
   * Daemon-local turn-progress notification (agent process service → task
   * service). Without it, progress is observed but not reported.
   */
  onTurnProgress?: ((event: { chatroomId: string; role: string }) => void) | undefined;
}

/**
 * After native harness spawn: durably enqueue the waiting projection.
 * Returns true after local persistence; backend delivery proceeds independently.
 */
export async function emitNativeWaitingAfterSpawn(
  ctx: NativeSpawnPresenceContext,
  harness: AgentHarness | string,
  opts?: { onError?: ((err: Error) => void) | undefined }
): Promise<boolean> {
  if (!isTeamAgentRole(ctx.role)) return false;
  if (!getHarnessCapabilities(harness as AgentHarness).supportsNativeIntegration) {
    return false;
  }
  try {
    if (!ctx.lifecycleOutbox) throw new Error('lifecycle outbox missing');
    await ctx.lifecycleOutbox.enqueue(
      buildActivityLifecycleFact({
        chatroomId: ctx.chatroomId,
        role: ctx.role,
        action: NATIVE_WAITING_ACTION,
      })
    );
    return true;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (opts?.onError) {
      opts.onError(error);
    }
    return false;
  }
}

/**
 * Wire harness output to turn-progress notifications.
 * When activityEmitter is present, reports first typed progress per turn only;
 * otherwise reports raw output throttled (default 30s). The notification is a
 * daemon-local callback — the task service decides what it means; the backend
 * is never written from here.
 */
function fireTokenActivity(
  onTurnProgress: (event: { chatroomId: string; role: string }) => void,
  chatroomId: string,
  role: string,
  now: () => number,
  lastReportedTokenAt: { value: number },
  throttleMs: number
): void {
  const t = now();
  if (lastReportedTokenAt.value === 0 || t - lastReportedTokenAt.value >= throttleMs) {
    lastReportedTokenAt.value = t;
    onTurnProgress({ chatroomId, role });
  }
}

export function wireTokenActivityReporting(opts: WireTokenActivityReportingOpts): void {
  if (!isTeamAgentRole(opts.role)) return;
  const onTurnProgress = opts.onTurnProgress;
  if (!onTurnProgress) return;

  if (opts.activityEmitter) {
    opts.activityEmitter.onActivity((signal) => {
      if (signal.kind !== 'progress' || !signal.isFirstForTurn) return;
      onTurnProgress({ chatroomId: opts.chatroomId, role: opts.role });
    });
    return;
  }

  const now = opts.now ?? (() => Date.now());
  const throttleMs = opts.throttleMs ?? NATIVE_TOKEN_ACTIVITY_THROTTLE_MS;
  const lastReportedTokenAt = { value: 0 };
  const register = opts.spawnResult.onOutput;
  if (!register) return;

  register(() => {
    fireTokenActivity(
      onTurnProgress,
      opts.chatroomId,
      opts.role,
      now,
      lastReportedTokenAt,
      throttleMs
    );
  });
}

/** @deprecated Use wireTokenActivityReporting. */
// fallow-ignore-next-line unused-export
export const wireThrottledTokenActivityOnOutput = wireTokenActivityReporting;
