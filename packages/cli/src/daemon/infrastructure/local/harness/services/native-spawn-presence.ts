import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';

import type { SpawnResult } from './remote-agent-service.js';
import { api } from '../../../../../api.js';
import type { BackendOps } from '../../../../../infrastructure/deps/index.js';
import type { AgentHarness } from '../../../../../infrastructure/machine/types.js';
import {
  buildActivityLifecycleFact,
  type AgentLifecycleFact,
} from '../../../../domain/entities/agent-lifecycle-fact.js';
import { isTeamAgentRole } from '../../../../domain/entities/execution-kind.js';
import type { HarnessActivityEmitter } from '../../../agent-process-manager/harness-activity-emitter.js';

export const NATIVE_TOKEN_ACTIVITY_THROTTLE_MS = 30_000;

export interface NativeSpawnPresenceContext {
  backend: BackendOps;
  sessionId: string;
  chatroomId: string;
  role: string;
  lifecycleOutbox?: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
}

export interface WireTokenActivityReportingOpts extends NativeSpawnPresenceContext {
  spawnResult: Pick<SpawnResult, 'onOutput'>;
  /** Defaults to Date.now — APM passes clock.now for testability */
  now?: () => number;
  throttleMs?: number;
  /** Optional typed activity emitter. When present, uses one unthrottled subscription instead of raw onOutput. */
  activityEmitter?: HarnessActivityEmitter;
}

/**
 * After native harness spawn: emit agent.waiting via participants.join.
 * Returns true if join was attempted and succeeded; false if harness is not native or join failed.
 */
export async function emitNativeWaitingAfterSpawn(
  ctx: NativeSpawnPresenceContext,
  harness: AgentHarness | string,
  opts?: { onError?: (err: Error) => void }
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
 * Wire spawnResult.onOutput to throttled participants.updateTokenActivity.
 * First output fires immediately; subsequent calls throttled (default 30s).
 * When activityEmitter is present, reports first typed progress per turn only.
 */
function fireTokenActivity(
  backend: BackendOps,
  sessionId: string,
  chatroomId: string,
  role: string,
  now: () => number,
  lastReportedTokenAt: { value: number },
  throttleMs: number
): void {
  const t = now();
  if (lastReportedTokenAt.value === 0 || t - lastReportedTokenAt.value >= throttleMs) {
    lastReportedTokenAt.value = t;
    void backend
      .mutation(api.participants.updateTokenActivity, {
        sessionId,
        chatroomId,
        role,
      })
      .catch(() => {});
  }
}

export function wireTokenActivityReporting(opts: WireTokenActivityReportingOpts): void {
  if (!isTeamAgentRole(opts.role)) return;

  if (opts.activityEmitter) {
    opts.activityEmitter.onActivity((signal) => {
      if (signal.kind !== 'progress' || !signal.isFirstForTurn) return;
      void opts.backend
        .mutation(api.participants.updateTokenActivity, {
          sessionId: opts.sessionId,
          chatroomId: opts.chatroomId,
          role: opts.role,
        })
        .catch(() => {});
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
      opts.backend,
      opts.sessionId,
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
