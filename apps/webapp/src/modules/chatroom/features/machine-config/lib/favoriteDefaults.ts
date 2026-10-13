import type { AgentConfig, AgentHarness } from '../../../types/machine';
import type { MachineConfigEntry } from '../types/machineConfig';

/**
 * Pure helpers that turn machine favourites into agent defaults. No React or Convex imports.
 * Favourites are ordered: index 0 is the top favourite.
 */

export interface FavoriteHarnessDefaultInput {
  favorites: readonly MachineConfigEntry[];
  availableHarnesses: readonly AgentHarness[];
  /**
   * True when a higher-priority source already decides the harness: the user explicitly chose a
   * harness or model on this machine, a running agent exists, or a persisted snapshot or team
   * config seeded it. The favourite default never applies in that case.
   */
  blocked: boolean;
}

/**
 * Harness the favourite default should set. Returns the first favourite (in rank order) whose
 * harness is installed on the machine, or null when blocked or when no favourite is usable.
 */
export function favoriteHarnessDefault(input: FavoriteHarnessDefaultInput): AgentHarness | null {
  if (input.blocked) return null;
  const usable = input.favorites.find((f) => input.availableHarnesses.includes(f.agentHarness));
  return usable ? usable.agentHarness : null;
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

/** The favourite default is blocked by an explicit choice, a running agent, or a saved snapshot. */
export function favoriteDefaultBlocked(
  harnessTouched: boolean,
  runningAgentConfig: AgentConfig | undefined,
  hasSnapshot: boolean
): boolean {
  return harnessTouched || !!runningAgentConfig || hasSnapshot;
}
