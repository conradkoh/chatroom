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

export function inferCopilotModelProvider(modelId: string): string {
  const base = modelId.split('[')[0];
  if (base.startsWith('claude')) return 'anthropic';
  if (base.startsWith('gpt')) return 'openai';
  if (base.startsWith('gemini')) return 'google';
  return 'github-copilot';
}

export function inferCommandCodeModelProvider(modelId: string): string {
  const base = modelId.split('[')[0];
  if (base.startsWith('claude')) return 'anthropic';
  if (base.startsWith('gpt')) return 'openai';
  return 'commandcode';
}

export function prefixCatalogModels(provider: string, models: readonly string[]): string[] {
  return models.map((model) => prefixModelWithProvider(provider, model));
}

export function prefixCatalogModelsWithInfer(
  infer: (modelId: string) => string,
  models: readonly string[]
): string[] {
  return models.map((model) => prefixModelWithProvider(infer(model), model));
}
