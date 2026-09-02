/** Parse a flat CLI slug (e.g. `gpt-5.4-high-thinking`) into base + params. */
export function cursorLegacySlugToVariant(flatSlug: string) {
  let base = flatSlug;
  const params: Record<string, string> = {};
  if (/-thinking$/.test(base)) {
    params.thinking = 'enabled';
    base = base.replace(/-thinking$/, '');
  }
  if (/-fast$/.test(base)) {
    params.fast = 'enabled';
    base = base.replace(/-fast$/, '');
  }
  const effort = base.match(/-(low|medium|high|xhigh|max)$/)?.[1];
  if (effort) {
    // Opus "max" in Cursor UI maps to xhigh effort; GPT 5.6 models use literal "max".
    params.effort = effort === 'max' && base.includes('opus') ? 'xhigh' : effort;
    base = base.slice(0, -(effort.length + 1));
  }
  if (Object.keys(params).length === 0) return undefined;
  return { base, params };
}

/**
 * SDK catalog uses `reasoning`; legacy CLI slugs use `effort` suffixes.
 * Maps SDK-only params to CLI-slug params. SDK-only keys (e.g. context) are dropped.
 * Does NOT mutate the original params object.
 */
// fallow-ignore-next-line complexity
export function normalizeCursorParamsForCliSlug(
  params: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};

  const effort =
    params.effort ??
    (params.reasoning && params.reasoning !== 'none' ? params.reasoning : undefined);
  if (effort && effort !== 'none') {
    out.effort = effort;
  }

  if (params.fast === 'enabled' || params.fast === 'true') {
    out.fast = 'enabled';
  }

  if (params.thinking === 'enabled' || params.thinking === 'true') {
    out.thinking = 'enabled';
  }

  return out;
}

export function cursorVariantToCliSlug(base: string, params: Record<string, string>): string {
  const suffix: string[] = [];
  if (params.effort && params.effort !== 'none')
    suffix.push(params.effort === 'xhigh' && base.includes('opus') ? 'max' : params.effort);
  if (params.fast === 'enabled') suffix.push('fast');
  if (params.thinking === 'enabled') suffix.push('thinking');
  return suffix.length ? `${base}-${suffix.join('-')}` : base;
}
