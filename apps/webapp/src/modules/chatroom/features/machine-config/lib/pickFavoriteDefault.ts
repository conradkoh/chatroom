import type { AgentHarness } from '../../../types/machine';
import type { MachineConfigEntry } from '../types/machineConfig';

/**
 * Pure helpers that turn machine favourites into agent defaults.
 * Favourites are ordered: index 0 is the top favourite.
 */

/**
 * First favourite (in rank order) whose harness is installed on the machine.
 * Returns null when none is usable.
 */
export function pickFavoriteDefault(
  favorites: readonly MachineConfigEntry[],
  availableHarnesses: readonly AgentHarness[]
): MachineConfigEntry | null {
  return favorites.find((f) => availableHarnesses.includes(f.agentHarness)) ?? null;
}

/**
 * First favourite for `harness` whose model is visible. Feeds selectModel's preferenceModel slot,
 * so it only applies when no higher-priority model source is set.
 */
export function pickFavoriteModelForHarness(
  favorites: readonly MachineConfigEntry[],
  harness: AgentHarness,
  visibleModels: readonly string[]
): string | undefined {
  return favorites.find((f) => f.agentHarness === harness && visibleModels.includes(f.model))
    ?.model;
}
