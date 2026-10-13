/**
 * Model selection utilities.
 *
 * Pure functions for deriving the best model to auto-select.
 * Model visibility (filter/blacklist) is defined in the backend domain and re-exported here.
 */

export {
  UNPREFIXED_PROVIDER_KEY,
  getBaseModelId,
  getModelProviderKey,
  isModelHidden,
  normalizeModelFilter,
} from '@workspace/backend/src/domain/entities/harness/model-filter';

// ─── Types ──────────────────────────────────────────────────────────

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
  const {
    selectedHarness,
    availableModels,
    visibleModels,
    userChoice,
    machineConfigModel,
    teamConfigModel,
    preferenceModel,
  } = input;

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
