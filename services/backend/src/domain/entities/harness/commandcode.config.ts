import type { HarnessCapabilities } from './types';

export const commandcodeCapabilities: HarnessCapabilities = {
  runtimeKind: 'cli',
  supportsSessionResume: false,
  supportsNativeIntegration: false,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['wire.log.agent_end'],
};
