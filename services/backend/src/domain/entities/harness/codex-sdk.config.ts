import type { HarnessCapabilities } from './types';

export const codexSdkCapabilities: HarnessCapabilities = {
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.codex.event'],
};
