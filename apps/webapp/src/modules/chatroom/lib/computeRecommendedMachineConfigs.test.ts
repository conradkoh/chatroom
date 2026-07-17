import { describe, expect, test } from 'vitest';

import { computeRecommendedMachineConfigs } from './computeRecommendedMachineConfigs';
import type { MachineConfigEntry } from '../types/machineConfig';

const NOW = 1700000000000;
const HOUR = 60 * 60 * 1000;

function makeEntry(harness: string, model: string): MachineConfigEntry {
  return { agentHarness: harness as any, model };
}

describe('computeRecommendedMachineConfigs', () => {
  test('returns empty when no candidates have frecency', () => {
    const result = computeRecommendedMachineConfigs(
      new Map(),
      [],
      [makeEntry('opencode-sdk', 'gpt-4')],
      NOW
    );
    expect(result).toEqual([]);
  });

  test('returns up to 3 recommendations sorted by score', () => {
    const usage = new Map<string, number[]>([
      ['opencode-sdk|gpt-4', [NOW - HOUR]], // score 150
      ['opencode-sdk|claude', [NOW - 2 * HOUR, NOW - 3 * HOUR]], // score 300
      ['cursor|gpt-4', [NOW - 5 * 24 * HOUR]], // score 60
    ]);
    const candidates = [
      makeEntry('opencode-sdk', 'gpt-4'),
      makeEntry('opencode-sdk', 'claude'),
      makeEntry('cursor', 'gpt-4'),
    ];
    const result = computeRecommendedMachineConfigs(usage, [], candidates, NOW);
    expect(result).toHaveLength(3);
    expect(result[0].model).toBe('claude'); // highest score
    expect(result[1].model).toBe('gpt-4'); // second
    expect(result[2].model).toBe('gpt-4'); // third (cursor)
  });

  test('excludes favorites from recommendations', () => {
    const usage = new Map<string, number[]>([['opencode-sdk|gpt-4', [NOW - HOUR]]]);
    const favorites = [makeEntry('opencode-sdk', 'gpt-4')];
    const result = computeRecommendedMachineConfigs(
      usage,
      favorites,
      [makeEntry('opencode-sdk', 'gpt-4')],
      NOW
    );
    expect(result).toEqual([]);
  });

  test('deduplicates repeated candidates before scoring', () => {
    const usage = new Map<string, number[]>([['opencode-sdk|opencode/big-pickle', [NOW - HOUR]]]);
    const entry = makeEntry('opencode-sdk', 'opencode/big-pickle');
    const result = computeRecommendedMachineConfigs(usage, [], [entry, entry, entry], NOW);
    expect(result).toEqual([entry]);
  });

  test('limits to 3 recommendations', () => {
    const usage = new Map<string, number[]>();
    const candidates: MachineConfigEntry[] = [];
    for (let i = 0; i < 5; i++) {
      const entry = makeEntry('opencode-sdk', `model-${i}`);
      usage.set(`opencode-sdk|model-${i}`, [NOW - HOUR]);
      candidates.push(entry);
    }
    const result = computeRecommendedMachineConfigs(usage, [], candidates, NOW);
    expect(result).toHaveLength(3);
  });
});
