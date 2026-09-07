import type { HarnessCapabilities } from './types';

export const copilotCapabilities: HarnessCapabilities = {
  runtimeKind: 'cli',
  supportsNativeIntegration: false,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['wire.log.agent_end'],
};
