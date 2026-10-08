import { stripProviderPrefix } from '@workspace/backend/src/domain/entities/harness/model-provider';

import type { ProviderOption } from '../../direct-harness/components/harness-selectors/types';
import { getModelDisplayLabel } from '../../types/machine';

export function harnessModelKey(providerID: string, modelID: string): string {
  return `${providerID}::${modelID}`;
}

/** Drop case and separators (whitespace, dots, hyphens) so slug and spaced forms compare equal. */
function normalizeSlugSeparators(value: string): string {
  return value.toLowerCase().replace(/[\s.-]/g, '');
}

/**
 * True when a provider display name is just the model slug with its separators spaced out
 * (e.g. "Claude Haiku 5 5" for "claude-haiku-5-5"). Such names carry no branding, so they are
 * formatted from the model id. Names without a space are kept, so "GPT-4o" stays as written.
 */
function isDegradedSlugName(name: string, modelID: string): boolean {
  return name.includes(' ') && normalizeSlugSeparators(name) === normalizeSlugSeparators(modelID);
}

/** Format raw catalog names while preserving custom provider-supplied display names. */
export function getProviderModelLabel(
  provider: Pick<ProviderOption, 'providerID'>,
  model: ProviderOption['models'][number]
): string {
  const modelID = stripProviderPrefix(provider.providerID, model.modelID);
  const name = stripProviderPrefix(provider.providerID, model.name);
  return name === modelID || isDegradedSlugName(name, modelID)
    ? getModelDisplayLabel(modelID)
    : model.name;
}

/**
 * Label for a "providerID::modelID" key that is missing from the loaded catalog
 * (e.g. a stale saved config). Formats the key the same way as catalog models.
 */
export function getUnresolvedHarnessModelLabel(value: string): string {
  const [providerID, modelID] = value.split('::');
  if (!providerID || !modelID) return value;
  return getModelDisplayLabel(`${providerID}/${stripProviderPrefix(providerID, modelID)}`);
}

export function getHarnessModelLabel(providers: ProviderOption[], value: string): string | null {
  if (!value) return null;
  const [providerID, modelID] = value.split('::');
  const provider = providers.find((p) => p.providerID === providerID);
  const model = provider?.models.find((m) => m.modelID === modelID);
  if (!provider || !model) return null;
  return `${provider.name} / ${getProviderModelLabel(provider, model)}`;
}
