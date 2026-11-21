import type { HarnessCapabilities } from './types';

export const opencodeSdkCapabilities: HarnessCapabilities = {
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.opencode.session.idle', 'sdk.opencode.session.event'],
};
