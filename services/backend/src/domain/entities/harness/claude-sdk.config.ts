import type { HarnessCapabilities } from './types';

export const claudeSdkCapabilities: HarnessCapabilities = {
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.claude.message'],
};
