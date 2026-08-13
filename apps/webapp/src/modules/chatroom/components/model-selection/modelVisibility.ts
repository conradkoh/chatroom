export function isModelEffectivelyHidden(
  modelId: string,
  providerKey: string,
  hiddenModels: ReadonlySet<string>,
  hiddenProviders: ReadonlySet<string>
): boolean {
  const providerHidden = hiddenProviders.has(providerKey);
  const baseId = getBaseModelId(modelId);
  const hasOverride = hiddenModels.has(modelId) || (baseId !== modelId && hiddenModels.has(baseId));
  return providerHidden ? !hasOverride : hasOverride;
}
import { getBaseModelId } from '../../utils/modelSelection';
