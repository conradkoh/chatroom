import { decodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant';

import {
  adaptProviderGroupsToModelGroups,
  aggregateFlatModelsByProvider,
} from './modelGroupAdapter';
import type { ModelGroup } from './types';
import type { ProviderOption } from '../../direct-harness/components/harness-selectors/types';
import { getModelDisplayLabel } from '../../types/machine';
import { getModelProviderKey, UNPREFIXED_PROVIDER_KEY } from '../../utils/modelSelection';

/** Param keys whose value is identical across every model in the group. */
// fallow-ignore-next-line complexity
function findUniformVariantParamKeys(modelIds: string[]): Set<string> {
  if (modelIds.length <= 1) return new Set();

  const decodedParams = modelIds.map((id) => {
    try {
      return decodeModelVariant(id).params;
    } catch {
      return {};
    }
  });

  const allKeys = new Set<string>();
  for (const params of decodedParams) {
    for (const key of Object.keys(params)) allKeys.add(key);
  }

  const uniformKeys = new Set<string>();
  for (const key of allKeys) {
    const values = decodedParams.map((params) => params[key] ?? null);
    const first = values[0];
    if (values.every((value) => value === first)) {
      uniformKeys.add(key);
    }
  }
  return uniformKeys;
}

function relabelGroupWithUniformParamFilter(group: ModelGroup): ModelGroup {
  const omitParamKeys = findUniformVariantParamKeys(group.options.map((option) => option.value));
  if (omitParamKeys.size === 0) return group;

  return {
    ...group,
    options: group.options.map((option) => ({
      ...option,
      label: getModelDisplayLabel(option.value, { omitParamKeys }),
    })),
  };
}

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
  const groups = aggregateFlatModelsByProvider(
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
  return groups.map(relabelGroupWithUniformParamFilter);
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
