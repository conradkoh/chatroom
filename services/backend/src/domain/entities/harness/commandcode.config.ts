import type { HarnessCapabilities } from './types.js';

export const commandcodeCapabilities: HarnessCapabilities = {
  runtimeKind: 'cli',
  supportsSessionResume: false,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['wire.log.agent_end'],
};
