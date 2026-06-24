import type { HarnessCapabilities } from './types';

export const piCapabilities: HarnessCapabilities = {
  runtimeKind: 'cli',
  supportsSessionResume: false,
  supportsNativeIntegration: false,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: [
    'wire.ndjson.agent_start',
    'wire.ndjson.agent_end',
    'wire.ndjson.message_update',
    'wire.ndjson.tool_execution_start',
    'wire.ndjson.tool_execution_end',
    'wire.ndjson.get_state',
    'wire.log.agent_end',
  ],
};
