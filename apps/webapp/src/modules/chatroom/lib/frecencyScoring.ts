/**
 * Frécency Scoring Engine — computes frequency + recency scores for command ranking.
 *
 * Uses a decay-weighted algorithm similar to Firefox's frécency:
 * each usage contributes a weight based on how recently it occurred.
 *
 * This is a pure function module — no side effects, fully testable.
 */

// ─── Decay Brackets ─────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Decay brackets: each entry defines a time threshold and its weight.
 * More recent usages get higher weights.
 * Must be ordered from most recent to least recent.
 *
 * Tuned so that 3 uses within 4 hours (3×150=450) significantly outranks
 * older commands and causes them to rank first.
 */
const DECAY_BRACKETS: Array<{ maxAge: number; weight: number }> = [
  { maxAge: 4 * HOUR, weight: 150 },
  { maxAge: 1 * DAY, weight: 120 },
  { maxAge: 3 * DAY, weight: 90 },
  { maxAge: 7 * DAY, weight: 60 },
  { maxAge: 14 * DAY, weight: 30 },
  { maxAge: 30 * DAY, weight: 15 },
];

// ─── Core Algorithm ─────────────────────────────────────────────────────────

/**
 * Compute the frécency score for a command based on its usage timestamps.
 *
 * @param timestamps Array of Unix ms timestamps (when the command was used)
 * @param now Current time in Unix ms (defaults to Date.now(), injectable for testing)
 * @returns A non-negative frécency score. Higher = more frequently/recently used.
 */
export function computeFrecencyScore(timestamps: number[], now: number = Date.now()): number {
  let score = 0;

  for (const ts of timestamps) {
    const age = now - ts;
    if (age < 0) continue; // Future timestamp — skip

    // Find the matching decay bracket
    let weight = 0;
    for (const bracket of DECAY_BRACKETS) {
      if (age <= bracket.maxAge) {
        weight = bracket.weight;
        break;
      }
    }

    // Timestamps older than the last bracket are dropped (weight = 0)
    score += weight;
  }

  return score;
}

/**
 * Compute frécency scores for all tracked commands.
 *
 * @param usage Map of commandId → timestamps
 * @param now Current time (injectable for testing)
 * @returns Map of commandId → frécency score
 */
export function computeAllFrecencyScores(
  usage: Map<string, number[]>,
  now: number = Date.now()
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const [id, timestamps] of usage) {
    const score = computeFrecencyScore(timestamps, now);
    if (score > 0) {
      scores.set(id, score);
    }
  }

  return scores;
}

/**
 * Get the maximum frécency score from a map of scores.
 * Used for normalizing the boost factor.
 */
export function getMaxFrecencyScore(scores: Map<string, number>): number {
  let max = 0;
  for (const score of scores.values()) {
    if (score > max) max = score;
  }
  return max;
}

// ─── Ranked Filter ──────────────────────────────────────────────────────────

/**
 * Create a cmdk-compatible filter function that combines fuzzy matching with frécency boosting.
 *
 * @param fuzzyFilter The original fuzzy filter function (value, search) => number
 * @param frecencyScores Map of command label → frécency score
 * @returns A filter function compatible with cmdk's `filter` prop
 */
export function createRankedFilter(
  fuzzyFilter: (value: string, search: string, keywords?: string[]) => number,
  frecencyScores: Map<string, number>
): (value: string, search: string, keywords?: string[]) => number {
  const maxScore = getMaxFrecencyScore(frecencyScores);

  return (value: string, search: string, keywords?: string[]): number => {
    const fuzzyScore = fuzzyFilter(value, search, keywords);

    // If the fuzzy filter says no match, don't override
    if (fuzzyScore === 0 && search.length > 0) return 0;

    // Compute normalized frécency boost (0 to 1)
    const frecency = frecencyScores.get(value) ?? 0;
    const boost = maxScore > 0 ? frecency / maxScore : 0;

    if (search.length === 0) {
      // No search query — order purely by frécency (with small base to show all)
      return 1 + boost * 100;
    }

    // With search query — fuzzy score primary, frécency as tiebreaker
    return fuzzyScore * (1 + boost);
  };
}
