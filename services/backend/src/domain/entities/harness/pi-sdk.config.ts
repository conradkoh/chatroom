import type { HarnessCapabilities } from './types';

export const piSdkCapabilities: HarnessCapabilities = {
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.pi.session.event', 'wire.log.agent_end'],
};
