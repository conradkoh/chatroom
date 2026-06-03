const CURSOR_PROVIDER = 'cursor';

/** Strip `cursor/` prefix so the SDK receives a bare model slug. */
export function resolveCursorSdkModel(model: string): string {
  const prefix = `${CURSOR_PROVIDER}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}
