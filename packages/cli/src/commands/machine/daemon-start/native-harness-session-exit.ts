import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';

import { notifyNativeSessionLost } from './native-task-delivery-coordinator.js';
import type { AgentHarness } from './types.js';
import type { StopReason } from '../../../domain/agent-lifecycle/index.js';
import { shouldRetainHarnessSessionForReconnect } from '../../../domain/agent-lifecycle/index.js';
import { isCursorSdkRunErrorInLogs } from '../../../domain/agent-lifecycle/policies/cursor-sdk-run-error.js';

export interface NativeHarnessSessionExitContext {
  chatroomId: string;
  role: string;
  harness?: AgentHarness;
  harnessSessionId?: string;
  stopReason: StopReason;
  recentLogLines?: string[];
  supportsDaemonMemoryResume: boolean;
}

// fallow-ignore-next-line unused-export complexity
export function isNativeHarnessSessionDiscardedOnExit(
  ctx: Pick<
    NativeHarnessSessionExitContext,
    'harness' | 'harnessSessionId' | 'stopReason' | 'recentLogLines' | 'supportsDaemonMemoryResume'
  >
): boolean {
  const { harness, harnessSessionId, stopReason, recentLogLines, supportsDaemonMemoryResume } = ctx;
  if (!harness || !harnessSessionId) {
    return false;
  }
  if (isCursorSdkRunErrorInLogs(recentLogLines ?? [])) {
    return true;
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
