import type { AgentHarness } from '../agent';

const HARNESS_FAVORITE_DEFAULT_PROVIDER: Partial<Record<AgentHarness, string>> = {
  'cursor-sdk': 'cursor',
  'claude-sdk': 'anthropic',
  'codex-sdk': 'openai',
};

/** Prefix a bare model id with its provider, preserving any variant suffix. */
export function prefixModelWithProvider(provider: string, modelId: string): string {
  const bracket = modelId.indexOf('[');
  const base = bracket === -1 ? modelId : modelId.slice(0, bracket);
  const suffix = bracket === -1 ? '' : modelId.slice(bracket);
  if (base.includes('/')) return modelId;
  return `${provider}/${base}${suffix}`;
}

export function stripProviderPrefix(provider: string, modelId: string): string {
  const prefix = `${provider}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

/** Rewrite a favorite model id to provider-prefixed form when missing. Idempotent. */
export function migrateFavoriteModelForHarness(agentHarness: AgentHarness, model: string): string {
  const bracket = model.indexOf('[');
  const base = bracket === -1 ? model : model.slice(0, bracket);
  if (base.includes('/')) return model;

  const fixed = HARNESS_FAVORITE_DEFAULT_PROVIDER[agentHarness];
  if (fixed) return prefixModelWithProvider(fixed, model);
  return model;
}

export function prefixCatalogModels(provider: string, models: readonly string[]): string[] {
  return models.map((model) => prefixModelWithProvider(provider, model));
}
