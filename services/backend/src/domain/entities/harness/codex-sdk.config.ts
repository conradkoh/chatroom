import type { HarnessCapabilities } from './types';

export const codexSdkCapabilities: HarnessCapabilities = {
  runtimeKind: 'sdk',
  supportsDaemonMemoryResume: true,
  supportsNativeIntegration: true,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.codex.event'],
};
