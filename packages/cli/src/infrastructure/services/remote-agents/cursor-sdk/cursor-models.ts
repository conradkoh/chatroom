const CURSOR_PROVIDER = 'cursor';

/**
 * Valid Cursor SDK model IDs that Cursor.models.list omits but Agent.create accepts.
 * Merged in listModels() — the daemon's discoverModels() path is the sole source of
 * truth for what the web UI lists (register/refreshCapabilities → getMachineModels).
 */
const CURSOR_SDK_BUILTIN_MODELS = ['auto'] as const;

/** Strip `cursor/` prefix so the SDK receives a bare model slug. */
export function resolveCursorSdkModel(model: string): string {
  const prefix = `${CURSOR_PROVIDER}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

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
