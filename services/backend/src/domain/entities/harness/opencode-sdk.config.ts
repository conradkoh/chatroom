import type { HarnessCapabilities } from './types.js';

export const opencodeSdkCapabilities: HarnessCapabilities = {
  runtimeKind: 'sdk',
  supportsSessionResume: true,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.opencode.session.idle', 'sdk.opencode.session.event'],
};
