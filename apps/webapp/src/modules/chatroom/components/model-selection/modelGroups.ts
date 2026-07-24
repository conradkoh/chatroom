import {
  adaptProviderGroupsToModelGroups,
  aggregateFlatModelsByProvider,
} from './modelGroupAdapter';
import type { ModelGroup } from './types';
import type { ProviderOption } from '../../direct-harness/components/harness-selectors/types';
import { getModelDisplayLabel } from '../../types/machine';
import { getModelProviderKey, UNPREFIXED_PROVIDER_KEY } from '../../utils/modelSelection';

export function titleCaseProvider(provider: string): string {
  return provider
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

export function getProviderDisplayName(providerKey: string): string {
  if (providerKey === UNPREFIXED_PROVIDER_KEY) return 'Models';
  return titleCaseProvider(providerKey);
}

/** Group flat model IDs (agent/multi-agent format) by provider key. */
export function groupFlatModels(models: string[]): ModelGroup[] {
  if (models.length === 0) return [];
  return aggregateFlatModelsByProvider(
    models.map((model) => {
      const providerKey = getModelProviderKey(model);
      return {
        providerKey,
        providerLabel: getProviderDisplayName(providerKey),
        value: model,
        label: getModelDisplayLabel(model),
      };
    })
  );
}

/** Group ProviderOption[] (harness format) into ModelGroups. */
export function groupProviderOptions(
  providers: ProviderOption[],
  options?: {
    modelKey?: (providerID: string, modelID: string) => string;
    modelLabel?: (provider: ProviderOption, model: { modelID: string; name: string }) => string;
  }
): ModelGroup[] {
  if (providers.length === 0) return [];
  const modelKey = options?.modelKey ?? ((p: string, m: string) => `${p}::${m}`);
  const modelLabel =
    options?.modelLabel ??
    ((_provider: ProviderOption, model: { modelID: string; name: string }) => model.name);

  return adaptProviderGroupsToModelGroups(
    providers.map((provider) => ({
      providerKey: provider.providerID,
      providerLabel: provider.name,
      options: provider.models.map((model) => ({
        value: modelKey(provider.providerID, model.modelID),
        label: modelLabel(provider, model),
      })),
    }))
  );
}

/** Flatten ProviderOption[] to filter-panel model IDs (`providerID/modelID`). */
export function providerOptionsToFilterModelIds(providers: ProviderOption[]): string[] {
  return providers.flatMap((p) => p.models.map((m) => `${p.providerID}/${m.modelID}`));
}

/** Find the display label for a value within ModelGroup[]. */
export function findModelLabel(groups: ModelGroup[], value: string): string | undefined {
  if (!value) return undefined;
  for (const group of groups) {
    for (const option of group.options) {
      if (option.value === value) return option.label;
    }
  }
  return undefined;
}

/** Check if any model in groups has visible (non-hidden) options. */
export function hasVisibleModels(
  groups: ModelGroup[],
  isHidden?: (value: string) => boolean
): boolean {
  if (!isHidden) return groups.some((g) => g.options.length > 0);
  return groups.some((g) => g.options.some((o) => !isHidden(o.value)));
}
