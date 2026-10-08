import { stripProviderPrefix } from '@workspace/backend/src/domain/entities/harness/model-provider';

import type { ProviderOption } from '../../direct-harness/components/harness-selectors/types';
import { getModelDisplayLabel } from '../../types/machine';

export function harnessModelKey(providerID: string, modelID: string): string {
  return `${providerID}::${modelID}`;
}

/** Format raw catalog names while preserving provider-supplied display names. */
export function getProviderModelLabel(
  provider: Pick<ProviderOption, 'providerID'>,
  model: ProviderOption['models'][number]
): string {
  const modelID = stripProviderPrefix(provider.providerID, model.modelID);
  const name = stripProviderPrefix(provider.providerID, model.name);
  return name === modelID ? getModelDisplayLabel(modelID) : model.name;
}

export function getHarnessModelLabel(providers: ProviderOption[], value: string): string | null {
  if (!value) return null;
  const [providerID, modelID] = value.split('::');
  const provider = providers.find((p) => p.providerID === providerID);
  const model = provider?.models.find((m) => m.modelID === modelID);
  if (!provider || !model) return null;
  return `${provider.name} / ${getProviderModelLabel(provider, model)}`;
}
