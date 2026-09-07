import type { HarnessCapabilities } from './types';

export const claudeCapabilities: HarnessCapabilities = {
  runtimeKind: 'cli',
  supportsNativeIntegration: false,
  lifecycle: {
    turnCompleted: false,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: [],
};
