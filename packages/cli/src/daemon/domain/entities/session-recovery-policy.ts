// fallow-ignore-file unused-file
import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';

import type { SessionExitClassification } from './session-monitor.js';
import type { AgentHarness } from '../../../infrastructure/machine/types.js';

export interface HarnessCrashRecoveryPolicy {
  maxAttempts: number;
  intervalMs: number;
  resumeFirstAttempts: number;
  recoveryReason: string;
}

export const DEFAULT_CRASH_RECOVERY_POLICY: HarnessCrashRecoveryPolicy = {
  maxAttempts: 1,
  intervalMs: 0,
  resumeFirstAttempts: 0,
  recoveryReason: 'platform.crash_recovery',
};

export function resolveSessionRecoveryPolicy(
  harness: AgentHarness,
  classification: SessionExitClassification
): HarnessCrashRecoveryPolicy {
  const caps = getHarnessCapabilities(harness);
  if (classification.hadSessionFailure && caps.crashRecovery?.onSessionFailure) {
    return caps.crashRecovery.onSessionFailure;
  }
  return DEFAULT_CRASH_RECOVERY_POLICY;
}
