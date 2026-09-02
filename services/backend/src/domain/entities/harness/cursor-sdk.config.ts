import type { HarnessCapabilities } from './types';

export const cursorSdkCapabilities: HarnessCapabilities = {
  runtimeKind: 'sdk',
  supportsDaemonMemoryResume: true,
  supportsNativeIntegration: true,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  crashRecovery: {
    onSessionFailure: {
      maxAttempts: 6,
      intervalMs: 10_000,
      resumeFirstAttempts: 3,
      recoveryReason: 'platform.cursor_sdk_session_reopen',
    },
  },
  wireEvents: ['sdk.cursor.message', 'sdk.cursor.run.completed', 'wire.log.agent_end'],
};
