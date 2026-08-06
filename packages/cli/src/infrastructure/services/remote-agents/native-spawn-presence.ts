import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';

import type { SpawnResult } from './remote-agent-service.js';
import { api } from '../../../api.js';
import { isTeamAgentRole } from '../../../daemon/domain/entities/execution-kind.js';
import { TOKEN_ACTIVITY_KINDS } from '../../../daemon/infrastructure/agent-process-manager/harness-activity-emitter.js';
import type { HarnessActivityEmitter } from '../../../daemon/infrastructure/agent-process-manager/harness-activity-emitter.js';
import type { BackendOps } from '../../deps/index.js';
import type { AgentHarness } from '../../machine/types.js';

export const NATIVE_TOKEN_ACTIVITY_THROTTLE_MS = 30_000;

export interface NativeSpawnPresenceContext {
  backend: BackendOps;
  sessionId: string;
  chatroomId: string;
  role: string;
}

export interface WireThrottledTokenActivityOpts extends NativeSpawnPresenceContext {
  spawnResult: Pick<SpawnResult, 'onOutput'>;
  /** Defaults to Date.now — APM passes clock.now for testability */
  now?: () => number;
  throttleMs?: number;
  /** Optional typed activity emitter. When present, subscribes to TOKEN_ACTIVITY_KINDS instead of raw onOutput. */
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
    await ctx.backend.mutation(api.participants.join, {
      sessionId: ctx.sessionId,
      chatroomId: ctx.chatroomId,
      role: ctx.role,
      action: NATIVE_WAITING_ACTION,
    });
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

export function wireThrottledTokenActivityOnOutput(opts: WireThrottledTokenActivityOpts): void {
  if (!isTeamAgentRole(opts.role)) return;
  const now = opts.now ?? (() => Date.now());
  const throttleMs = opts.throttleMs ?? NATIVE_TOKEN_ACTIVITY_THROTTLE_MS;
  const lastReportedTokenAt = { value: 0 };

  if (opts.activityEmitter) {
    for (const _kind of TOKEN_ACTIVITY_KINDS) {
      opts.activityEmitter.onActivity(() => {
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
    return;
  }

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
