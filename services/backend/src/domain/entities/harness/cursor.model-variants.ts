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
    params.effort = effort === 'max' ? 'xhigh' : effort;
    base = base.slice(0, -(effort.length + 1));
  }
  if (Object.keys(params).length === 0) return undefined;
  return { base, params };
}

export function cursorVariantToCliSlug(base: string, params: Record<string, string>): string {
  const suffix: string[] = [];
  if (params.effort && params.effort !== 'none')
    suffix.push(params.effort === 'xhigh' && base.includes('opus') ? 'max' : params.effort);
  if (params.fast === 'enabled') suffix.push('fast');
  if (params.thinking === 'enabled') suffix.push('thinking');
  return suffix.length ? `${base}-${suffix.join('-')}` : base;
}
