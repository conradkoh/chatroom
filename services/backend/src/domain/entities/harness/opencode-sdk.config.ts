import type { HarnessCapabilities } from './types';

export const opencodeSdkCapabilities: HarnessCapabilities = {
  runtimeKind: 'sdk',
  supportsSessionResume: false,
  supportsNativeIntegration: true,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.opencode.session.idle', 'sdk.opencode.session.event'],
};
