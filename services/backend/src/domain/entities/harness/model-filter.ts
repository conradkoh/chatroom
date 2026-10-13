/**
 * Model visibility filter — the single definition of which models are hidden
 * for a machine and harness.
 *
 * The webapp model picker and the backend favourites pruning both read this
 * module, so they cannot disagree about what "hidden" means.
 */

import { decodeModelVariant } from './model-variant';

// ─── Types ──────────────────────────────────────────────────────────

export interface ModelFilter {
  hiddenModels: string[];
  hiddenProviders: string[];
}

// ─── Provider grouping ─────────────────────────────────────────────

/** Sentinel key for legacy filters that hid the unprefixed "Models" bucket. */
export const UNPREFIXED_PROVIDER_KEY = '__unprefixed__';

/**
 * Drops the legacy unprefixed sentinel from `hiddenProviders`.
 *
 * Constraint: the picker applies this before {@link isModelHidden}, so the
 * sentinel never hides the unprefixed bucket. Pruning must apply it too.
 */
export function normalizeModelFilter(filter: ModelFilter | null | undefined): ModelFilter | null {
  if (!filter) return null;
  return {
    hiddenModels: filter.hiddenModels,
    hiddenProviders: filter.hiddenProviders.filter((p) => p !== UNPREFIXED_PROVIDER_KEY),
  };
}

/** Strip variant suffix for grouping/filtering; returns input on parse failure. */
export function getBaseModelId(modelId: string): string {
  try {
    return decodeModelVariant(modelId).model;
  } catch {
    return modelId;
  }
}

/**
 * Provider key used for filter grouping and hide-all semantics.
 * Variant models group under their base model id; prefixed models use the segment before `/`.
 */
export function getModelProviderKey(modelId: string): string {
  const base = getBaseModelId(modelId);
  const slashIndex = base.indexOf('/');
  if (slashIndex === -1) return base;
  return base.slice(0, slashIndex);
}

// ─── isModelHidden ──────────────────────────────────────────────────

/**
 * Returns true if the given model should be hidden based on the machine-level filter.
 *
 * Filter semantics:
 * - `hiddenProviders`: provider keys from {@link getModelProviderKey} to hide
 * - `hiddenModels`: when the provider IS hidden, these are **exceptions** (models to UN-hide);
 *   when the provider is NOT hidden, these are models to hide individually.
 */
// fallow-ignore-next-line complexity
export function isModelHidden(modelId: string, filter: ModelFilter | null | undefined): boolean {
  if (!filter) return false;
  const baseId = getBaseModelId(modelId);
  const provider = getModelProviderKey(modelId);
  const unprefixedBucketHidden =
    baseId.indexOf('/') === -1 && filter.hiddenProviders.includes(UNPREFIXED_PROVIDER_KEY);
  const providerHidden = filter.hiddenProviders.includes(provider) || unprefixedBucketHidden;
  const hasExactMatch = filter.hiddenModels.includes(modelId);
  // Base-ID matching is only for exceptions to a hidden provider; individual
  // model hides must match the complete model ID, including any variant.
  const hasBaseException =
    providerHidden && baseId !== modelId && filter.hiddenModels.includes(baseId);
  const hasExplicitOverride = hasExactMatch || hasBaseException;

  if (providerHidden) {
    // Provider is hidden; hiddenModels contains exceptions (models to UN-hide)
    return !hasExplicitOverride;
  }
  // Provider is visible; hiddenModels contains models to hide
  return hasExplicitOverride;
}

// ─── pruneHiddenFavorites ───────────────────────────────────────────

interface FavoriteEntry {
  agentHarness: string;
  model: string;
}

/**
 * Removes favourites of `harness` whose model is hidden by `filter`.
 * Favourites for other harnesses, and visible favourites, keep their order.
 *
 * Returns the same array instance when nothing is removed, so callers can skip the write
 * with a reference check.
 *
 * Constraint: the model key is normalized with the same `::` → `/` rule the picker applies
 * before checking hidden state, so a favourite the UI shows as hidden is always pruned.
 */
export function pruneHiddenFavorites<T extends FavoriteEntry>(
  favorites: T[],
  harness: string,
  filter: ModelFilter
): T[] {
  const effectiveFilter = normalizeModelFilter(filter);
  const kept = favorites.filter(
    (favorite) =>
      favorite.agentHarness !== harness ||
      !isModelHidden(favorite.model.replace('::', '/'), effectiveFilter)
  );
  return kept.length === favorites.length ? favorites : kept;
}
