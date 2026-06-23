import type { HarnessCapabilities } from './types';

export const piSdkCapabilities: HarnessCapabilities = {
  runtimeKind: 'sdk',
  supportsSessionResume: false,
  supportsNativeIntegration: true,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.pi.session.event', 'wire.log.agent_end'],
};
