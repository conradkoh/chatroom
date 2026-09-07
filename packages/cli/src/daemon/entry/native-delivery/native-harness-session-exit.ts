import { notifyNativeSessionLost } from './native-task-delivery-coordinator.js';
import type { AgentHarness } from '../daemon-types.js';

export interface NativeHarnessSessionExitContext {
  chatroomId: string;
  role: string;
  harness?: AgentHarness | undefined;
  harnessSessionId?: string | undefined;
}

// fallow-ignore-next-line complexity
export function notifyNativeHarnessSessionLostOnExit(ctx: NativeHarnessSessionExitContext): void {
  if (!ctx.harness || !ctx.harnessSessionId) {
    return;
  }

  notifyNativeSessionLost({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    harnessSessionId: ctx.harnessSessionId,
  });
}
