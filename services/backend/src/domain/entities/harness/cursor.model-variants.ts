import {
  ModelVariantValidationError,
  encodeModelVariant,
  type ModelVariantSchema,
} from './model-variant';

export const CURSOR_THINKING_VALUES = ['none', 'enabled'] as const;
export const CURSOR_EFFORT_VALUES = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
export const CURSOR_FAST_VALUES = ['none', 'enabled'] as const;
export type CursorThinking = (typeof CURSOR_THINKING_VALUES)[number];
export type CursorEffort = (typeof CURSOR_EFFORT_VALUES)[number];
export type CursorFast = (typeof CURSOR_FAST_VALUES)[number];

export const CURSOR_MODEL_VARIANT_COMBINATIONS = [
  {},
  { thinking: 'enabled' },
  { fast: 'enabled' },
  { effort: 'low' },
  { effort: 'medium' },
  { effort: 'high' },
  { effort: 'xhigh' },
  { effort: 'low', fast: 'enabled' },
  { effort: 'medium', fast: 'enabled' },
  { effort: 'high', fast: 'enabled' },
  { effort: 'xhigh', fast: 'enabled' },
  { effort: 'low', thinking: 'enabled' },
  { effort: 'medium', thinking: 'enabled' },
  { effort: 'high', thinking: 'enabled' },
  { effort: 'xhigh', thinking: 'enabled' },
  { effort: 'low', fast: 'enabled', thinking: 'enabled' },
  { effort: 'medium', fast: 'enabled', thinking: 'enabled' },
  { effort: 'high', fast: 'enabled', thinking: 'enabled' },
  { effort: 'xhigh', fast: 'enabled', thinking: 'enabled' },
] as const satisfies ModelVariantSchema;

export const CURSOR_LEGACY_MODEL_SLUGS = [
  'claude-4.6-opus-high',
  'claude-4.6-opus-high-thinking',
  'claude-4.6-opus-max',
  'claude-4.6-opus-max-thinking',
  'claude-4.5-opus-high',
  'claude-4.5-opus-high-thinking',
  'claude-4.6-sonnet-medium',
  'claude-4.6-sonnet-medium-thinking',
  'claude-4.5-sonnet',
  'claude-4.5-sonnet-thinking',
  'claude-4-sonnet',
  'claude-4-sonnet-thinking',
  'claude-4-sonnet-1m',
  'claude-4-sonnet-1m-thinking',
  'gpt-5.4-low',
  'gpt-5.4-medium',
  'gpt-5.4-medium-fast',
  'gpt-5.4-high',
  'gpt-5.4-high-fast',
  'gpt-5.4-xhigh',
  'gpt-5.4-xhigh-fast',
  'gpt-5.3-codex-low',
  'gpt-5.3-codex-low-fast',
  'gpt-5.3-codex',
  'gpt-5.3-codex-fast',
  'gpt-5.3-codex-high',
  'gpt-5.3-codex-high-fast',
  'gpt-5.3-codex-xhigh',
  'gpt-5.3-codex-xhigh-fast',
  'gpt-5.3-codex-spark-preview',
  'gpt-5.2',
  'gpt-5.2-high',
  'gpt-5.2-codex-low',
  'gpt-5.2-codex-low-fast',
  'gpt-5.2-codex',
  'gpt-5.2-codex-fast',
  'gpt-5.2-codex-high',
  'gpt-5.2-codex-high-fast',
  'gpt-5.2-codex-xhigh',
  'gpt-5.2-codex-xhigh-fast',
  'gpt-5.1-high',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-high',
  'gpt-5.1-codex-mini',
  'gemini-3.1-pro',
  'gemini-3-pro',
  'gemini-3-flash',
  'grok',
  'kimi-k2.5',
  'auto',
  'composer-2.5',
  'composer-2',
  'composer-1.5',
  'composer-1',
] as const;

export const CURSOR_CATALOG_BASE_MODEL_IDS = [...new Set(CURSOR_LEGACY_MODEL_SLUGS.map((slug) => cursorLegacySlugToVariant(slug)?.base).filter((base): base is string => base !== undefined))] as const;
export type CursorBaseModelId = (typeof CURSOR_CATALOG_BASE_MODEL_IDS)[number] | string;

export function cursorLegacySlugToVariant(flatSlug: string) {
  if (!CURSOR_LEGACY_MODEL_SLUGS.includes(flatSlug as (typeof CURSOR_LEGACY_MODEL_SLUGS)[number]))
    return undefined;
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
  return { base, params };
}

export function expandCursorModelVariantCatalog(): string[] {
  return CURSOR_LEGACY_MODEL_SLUGS.map((slug) => {
    const variant = cursorLegacySlugToVariant(slug);
    return variant ? encodeModelVariant(variant.base, variant.params) : slug;
  });
}

export function cursorVariantToCliSlug(base: string, params: Record<string, string>): string {
  const suffix: string[] = [];
  if (params.effort && params.effort !== 'none')
    suffix.push(params.effort === 'xhigh' && base.includes('opus') ? 'max' : params.effort);
  if (params.fast === 'enabled') suffix.push('fast');
  if (params.thinking === 'enabled') suffix.push('thinking');
  return suffix.length ? `${base}-${suffix.join('-')}` : base;
}

export function validateCursorVariantForBase(base: string, params: Record<string, string>): void {
  const slug = cursorVariantToCliSlug(base, params);
  const parsed = cursorLegacySlugToVariant(slug);
  const keys = Object.keys(params);
  const paramsEqual = keys.length === Object.keys(parsed?.params ?? {}).length && keys.every((key) => parsed?.params[key] === params[key]);
  if (!parsed || parsed.base !== base || !paramsEqual) {
    throw new ModelVariantValidationError(`unsupported cursor variant for model "${base}"`);
  }
}
