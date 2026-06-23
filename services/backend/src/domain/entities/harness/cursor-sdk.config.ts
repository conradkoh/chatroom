import type { HarnessCapabilities } from './types';

export const cursorSdkCapabilities: HarnessCapabilities = {
  runtimeKind: 'sdk',
  supportsSessionResume: false,
  supportsNativeIntegration: true,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.cursor.message', 'sdk.cursor.run.completed', 'wire.log.agent_end'],
};
