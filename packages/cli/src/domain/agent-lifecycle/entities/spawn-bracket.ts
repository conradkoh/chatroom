/**
 * Tracks concurrent agent count per chatroom — must stay paired with recordExit.
 */
export interface SpawnBracketState {
  readonly concurrentCount: number;
}

export const emptySpawnBracket = (): SpawnBracketState => ({ concurrentCount: 0 });

export function recordSpawn(state: SpawnBracketState): SpawnBracketState {
  return { concurrentCount: state.concurrentCount + 1 };
}

export function recordExit(state: SpawnBracketState): SpawnBracketState {
  return { concurrentCount: Math.max(0, state.concurrentCount - 1) };
}

/**
 * Bracket invariant: after N spawns and M exits, count === max(0, N - M).
 */
export function bracketCountAfter(spawns: number, exits: number): number {
  return Math.max(0, spawns - exits);
}
