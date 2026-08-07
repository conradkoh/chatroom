export function isModelEffectivelyHidden(
  modelId: string,
  providerKey: string,
  hiddenModels: ReadonlySet<string>,
  hiddenProviders: ReadonlySet<string>
): boolean {
  const providerHidden = hiddenProviders.has(providerKey);
  const hasOverride = hiddenModels.has(modelId);
  return providerHidden ? !hasOverride : hasOverride;
}
