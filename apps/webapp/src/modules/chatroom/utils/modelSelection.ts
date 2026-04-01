/**
 * Model selection utilities.
 *
 * Pure functions for determining model visibility (filter/blacklist)
 * and deriving the best model to auto-select.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface ModelFilter {
  hiddenModels: string[];
  hiddenProviders: string[];
}

export interface ModelSelectionInput {
  /** Currently selected harness (null = no harness selected) */
  selectedHarness: string | null;
  /** All available models for the current harness (unfiltered) */
  availableModels: string[];
  /** Available models with blacklisted ones removed */
  visibleModels: string[];
  /** User's explicit per-harness model choice */
  userChoice?: string;
  /** Model saved in machine config for this harness */
  machineConfigModel?: string;
  /** Model from team config */
  teamConfigModel?: string;
  /** Model from saved user preference */
  preferenceModel?: string;
}

// ─── isModelHidden ──────────────────────────────────────────────────

/**
 * Returns true if the given model should be hidden based on the machine-level filter.
 *
 * Filter semantics:
 * - `hiddenProviders`: provider prefixes (the part before the first '/') to hide
 * - `hiddenModels`: when the provider IS hidden, these are **exceptions** (models to UN-hide);
 *   when the provider is NOT hidden, these are models to hide individually.
 */
export function isModelHidden(
  modelId: string,
  filter: ModelFilter | null | undefined
): boolean {
  if (!filter) return false;
  const provider = modelId.split('/')[0];
  const providerHidden = filter.hiddenProviders.includes(provider);
  const hasExplicitOverride = filter.hiddenModels.includes(modelId);

  if (providerHidden) {
    // Provider is hidden; hiddenModels contains exceptions (models to UN-hide)
    return !hasExplicitOverride;
  }
  // Provider is visible; hiddenModels contains models to hide
  return hasExplicitOverride;
}

// ─── selectModel ────────────────────────────────────────────────────

/**
 * Pure derivation of the best model to auto-select.
 *
 * Priority:
 *   1. User's explicit per-harness choice — validated against full list
 *      (respected even if hidden; the UI shows a warning)
 *   2. Machine config model — must be in visibleModels
 *   3. Team config model — must be in visibleModels
 *   4. Saved user preference model — must be in visibleModels
 *   5. First visible model (fallback to first available if all hidden)
 */
export function selectModel(input: ModelSelectionInput): string | null {
  const { selectedHarness, availableModels, visibleModels, userChoice, machineConfigModel, teamConfigModel, preferenceModel } = input;

  if (!selectedHarness || availableModels.length === 0) {
    return null;
  }

  // 1. Explicit user choice — validated against full list
  if (userChoice && availableModels.includes(userChoice)) {
    return userChoice;
  }

  // 2. Machine config model — must be visible
  if (machineConfigModel && visibleModels.includes(machineConfigModel)) {
    return machineConfigModel;
  }

  // 3. Team config model — must be visible
  if (teamConfigModel && visibleModels.includes(teamConfigModel)) {
    return teamConfigModel;
  }

  // 4. Saved user preference — must be visible
  if (preferenceModel && visibleModels.includes(preferenceModel)) {
    return preferenceModel;
  }

  // 5. First visible, fallback to first available
  return visibleModels[0] ?? availableModels[0];
}
