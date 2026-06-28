import type { ProviderOption } from './types';

export function modelKey(providerID: string, modelID: string): string {
  return `${providerID}::${modelID}`;
}

export function getVisibleModels(
  provider: ProviderOption,
  isHidden?: (modelKey: string) => boolean
) {
  return provider.models.filter(
    (model) => !isHidden?.(modelKey(provider.providerID, model.modelID))
  );
}

export function hasVisibleProviders(
  providers: ProviderOption[],
  isHidden?: (modelKey: string) => boolean
): boolean {
  return providers.some((provider) => getVisibleModels(provider, isHidden).length > 0);
}

export function getSelectedModelLabel(providers: ProviderOption[], value: string): string | null {
  if (!value) return null;
  const [providerID, modelID] = value.split('::');
  const provider = providers.find((p) => p.providerID === providerID);
  const model = provider?.models.find((m) => m.modelID === modelID);
  if (!provider || !model) return null;
  return `${provider.name} / ${model.name}`;
}
