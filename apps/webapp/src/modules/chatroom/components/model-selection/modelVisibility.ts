import { getBaseModelId } from '../../utils/modelSelection';

export function isModelEffectivelyHidden(
  modelId: string,
  providerKey: string,
  hiddenModels: ReadonlySet<string>,
  hiddenProviders: ReadonlySet<string>
): boolean {
  const providerHidden = hiddenProviders.has(providerKey);
  const baseId = getBaseModelId(modelId);
  const hasExactMatch = hiddenModels.has(modelId);
  const hasBaseException = providerHidden && baseId !== modelId && hiddenModels.has(baseId);
  const hasOverride = hasExactMatch || hasBaseException;
  return providerHidden ? !hasOverride : hasOverride;
}
