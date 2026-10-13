import { describe, expect, test } from 'vitest';

import { pickFavoriteDefault, pickFavoriteModelForHarness } from './pickFavoriteDefault';
import type { AgentHarness } from '../../../types/machine';
import type { MachineConfigEntry } from '../types/machineConfig';

const OPENCODE = 'opencode-sdk' as AgentHarness;
const CLAUDE = 'claude' as AgentHarness;

function entry(agentHarness: AgentHarness, model: string): MachineConfigEntry {
  return { agentHarness, model };
}

describe('pickFavoriteDefault', () => {
  test('returns the top-ranked favourite whose harness is installed', () => {
    const favorites = [entry(OPENCODE, 'm2'), entry(CLAUDE, 'm1')];
    expect(pickFavoriteDefault(favorites, [OPENCODE, CLAUDE])).toEqual(entry(OPENCODE, 'm2'));
  });

  test('skips a favourite whose harness is not installed', () => {
    const favorites = [entry(OPENCODE, 'm2'), entry(CLAUDE, 'm1')];
    expect(pickFavoriteDefault(favorites, [CLAUDE])).toEqual(entry(CLAUDE, 'm1'));
  });

  test('returns null when no favourite harness is installed', () => {
    expect(pickFavoriteDefault([entry(OPENCODE, 'm2')], [CLAUDE])).toBeNull();
  });

  test('returns null for an empty favourites list', () => {
    expect(pickFavoriteDefault([], [OPENCODE, CLAUDE])).toBeNull();
  });
});

describe('pickFavoriteModelForHarness', () => {
  test('returns the first favourite model for the harness that is visible', () => {
    const favorites = [entry(CLAUDE, 'c1'), entry(OPENCODE, 'hidden'), entry(OPENCODE, 'm2')];
    expect(pickFavoriteModelForHarness(favorites, OPENCODE, ['m2', 'm3'])).toBe('m2');
  });

  test('skips a favourite model that is hidden by the filter', () => {
    const favorites = [entry(OPENCODE, 'hidden'), entry(OPENCODE, 'm2')];
    expect(pickFavoriteModelForHarness(favorites, OPENCODE, ['m2'])).toBe('m2');
  });

  test('returns undefined when no favourite for the harness is visible', () => {
    expect(
      pickFavoriteModelForHarness([entry(OPENCODE, 'hidden')], OPENCODE, ['m2'])
    ).toBeUndefined();
  });

  test('returns undefined for an empty favourites list', () => {
    expect(pickFavoriteModelForHarness([], OPENCODE, ['m2'])).toBeUndefined();
  });

  test('ignores favourites for other harnesses', () => {
    expect(pickFavoriteModelForHarness([entry(CLAUDE, 'm2')], OPENCODE, ['m2'])).toBeUndefined();
  });
});
