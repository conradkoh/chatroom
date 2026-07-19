import { computeFrecencyScore } from '../../../lib/frecencyScoring';
import type { MachineConfigEntry } from '../types/machineConfig';
import { buildMachineConfigKey, entriesEqual } from '../types/machineConfig';

const MAX_RECOMMENDED = 3;

function dedupeCandidates(candidates: MachineConfigEntry[]): MachineConfigEntry[] {
  const seen = new Set<string>();
  const unique: MachineConfigEntry[] = [];
  for (const candidate of candidates) {
    const key = buildMachineConfigKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

export function computeRecommendedMachineConfigs(
  usage: Map<string, number[]>,
  favorites: MachineConfigEntry[],
  candidates: MachineConfigEntry[],
  now: number = Date.now()
): MachineConfigEntry[] {
  const scores = dedupeCandidates(candidates)
    .filter((c) => !favorites.some((f) => entriesEqual(f, c)))
    .map((c) => ({
      entry: c,
      score: computeFrecencyScore(usage.get(buildMachineConfigKey(c)) ?? [], now),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scores.slice(0, MAX_RECOMMENDED).map((x) => x.entry);
}
