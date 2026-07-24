import type { ModelGroup, ModelOption } from './types';

/** Normalized provider group before final ModelGroup[] output. */
export interface ProviderGroupSource {
  providerKey: string;
  providerLabel: string;
  options: ModelOption[];
}

/** Canonical adapter: ProviderGroupSource[] → ModelGroup[]. */
export function adaptProviderGroupsToModelGroups(sources: ProviderGroupSource[]): ModelGroup[] {
  return sources.map(({ providerKey, providerLabel, options }) => ({
    providerKey,
    providerLabel,
    options,
  }));
}

/** Aggregate flat model entries by providerKey (used by groupFlatModels). */
export function aggregateFlatModelsByProvider(
  entries: { providerKey: string; providerLabel: string; value: string; label: string }[]
): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const { providerKey, providerLabel, value, label } of entries) {
    const existing = groups.get(providerKey);
    if (existing) {
      existing.options.push({ value, label });
    } else {
      groups.set(providerKey, {
        providerKey,
        providerLabel,
        options: [{ value, label }],
      });
    }
  }
  return Array.from(groups.values());
}
