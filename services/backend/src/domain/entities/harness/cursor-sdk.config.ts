import type { HarnessCapabilities } from './types';

export const cursorSdkCapabilities: HarnessCapabilities = {
  runtimeKind: 'sdk',
  supportsSessionResume: true,
  lifecycle: {
    turnCompleted: true,
    outputActivity: true,
    processExited: true,
  },
  wireEvents: ['sdk.cursor.message', 'sdk.cursor.run.completed', 'wire.log.agent_end'],
};

/** Valid Cursor SDK model IDs that Cursor.models.list omits but Agent.create accepts. */
const CURSOR_SDK_BUILTIN_MODELS = ['auto'] as const;

/** Merge API-listed models with SDK built-ins missing from Cursor.models.list. */
export function mergeCursorSdkListedModels(listedModelIds: string[]): string[] {
  const merged = [...listedModelIds];
  for (const builtin of CURSOR_SDK_BUILTIN_MODELS) {
    if (!merged.includes(builtin)) {
      merged.unshift(builtin);
    }
  }
  return merged;
}
