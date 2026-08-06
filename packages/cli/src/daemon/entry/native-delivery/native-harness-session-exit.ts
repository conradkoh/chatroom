import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';

import { notifyNativeSessionLost } from './native-task-delivery-coordinator.js';
import type { AgentHarness } from '../../../commands/machine/daemon-start/types.js';
import type { StopReason } from '../../../daemon/domain/entities/stop-reason.js';
import { shouldRetainHarnessSessionForReconnect } from '../../../daemon/domain/usecase/preserve-harness-session.js';

export interface NativeHarnessSessionExitContext {
  chatroomId: string;
  role: string;
  harness?: AgentHarness;
  harnessSessionId?: string;
  stopReason: StopReason;
  recentLogLines?: string[];
  supportsDaemonMemoryResume: boolean;
}

export function isNativeHarnessSessionDiscardedOnExit(
  ctx: Pick<
    NativeHarnessSessionExitContext,
    'harness' | 'harnessSessionId' | 'stopReason' | 'recentLogLines' | 'supportsDaemonMemoryResume'
  >
): boolean {
  const { harness, harnessSessionId, stopReason, supportsDaemonMemoryResume } = ctx;
  if (!harness || !harnessSessionId) {
    return false;
  }
  if (!supportsDaemonMemoryResume) {
    return true;
  }
  return !shouldRetainHarnessSessionForReconnect(stopReason);
}

// fallow-ignore-next-line complexity
export function notifyNativeHarnessSessionLostOnExit(ctx: NativeHarnessSessionExitContext): void {
  if (
    !ctx.harness ||
    !ctx.harnessSessionId ||
    !getHarnessCapabilities(ctx.harness).supportsNativeIntegration ||
    !isNativeHarnessSessionDiscardedOnExit(ctx)
  ) {
    return;
  }

  notifyNativeSessionLost({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    harnessSessionId: ctx.harnessSessionId,
  });
}
