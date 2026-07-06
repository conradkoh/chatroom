import type { HarnessCapabilities } from './types';

export const claudeSdkCapabilities: HarnessCapabilities = {
  runtimeKind: 'sdk',
  supportsDaemonMemoryResume: true,
  supportsNativeIntegration: true,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.claude.message'],
};
