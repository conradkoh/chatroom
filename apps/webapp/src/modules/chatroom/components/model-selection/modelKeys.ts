import type { ProviderOption } from '../../direct-harness/components/harness-selectors/types';

export function harnessModelKey(providerID: string, modelID: string): string {
  return `${providerID}::${modelID}`;
}

export function getHarnessModelLabel(providers: ProviderOption[], value: string): string | null {
  if (!value) return null;
  const [providerID, modelID] = value.split('::');
  const provider = providers.find((p) => p.providerID === providerID);
  const model = provider?.models.find((m) => m.modelID === modelID);
  if (!provider || !model) return null;
  return `${provider.name} / ${model.name}`;
}
