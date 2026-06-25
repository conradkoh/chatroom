import type { HarnessCapabilities } from './types';

export const claudeCapabilities: HarnessCapabilities = {
  runtimeKind: 'cli',
  supportsDaemonMemoryResume: false,
  supportsNativeIntegration: false,
  lifecycle: {
    turnCompleted: false,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: [],
};
