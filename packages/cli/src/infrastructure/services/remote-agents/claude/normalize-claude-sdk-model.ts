/** Strip 1M context suffixes so SDK uses 200k window. */
export function normalizeClaudeSdkModelFor200k(model: string | undefined): string | undefined {
  if (!model) return model;
  return model.replace(/\[1m\]/gi, '').trim();
}
