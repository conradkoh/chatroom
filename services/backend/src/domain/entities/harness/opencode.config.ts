import type { HarnessCapabilities } from './types.js';

export const opencodeCapabilities: HarnessCapabilities = {
  runtimeKind: 'cli',
  supportsSessionResume: false,
  lifecycle: {
    turnCompleted: false,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: [],
};
