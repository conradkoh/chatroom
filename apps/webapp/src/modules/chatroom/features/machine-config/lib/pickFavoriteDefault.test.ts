import { describe, expect, test } from 'vitest';

import { favoriteHarnessDefault, pickFavoriteModelForHarness } from './pickFavoriteDefault';
import type { AgentHarness } from '../../../types/machine';
import type { MachineConfigEntry } from '../types/machineConfig';

const OPENCODE = 'opencode-sdk' as AgentHarness;
const PI = 'pi-sdk' as AgentHarness;
const CURSOR = 'cursor-sdk' as AgentHarness;

function entry(agentHarness: AgentHarness, model: string): MachineConfigEntry {
  return { agentHarness, model };
}

describe('favoriteHarnessDefault', () => {
  const favorites = [entry(OPENCODE, 'm2'), entry(PI, 'p1')];
  const installed = [OPENCODE, PI];

  test('returns the top-ranked favourite harness that is installed', () => {
    expect(
      favoriteHarnessDefault({ favorites, availableHarnesses: installed, blocked: false })
    ).toBe(OPENCODE);
  });

  test('skips a favourite whose harness is not installed', () => {
    const ordered = [entry(CURSOR, 'c1'), entry(PI, 'p1')];
    expect(
      favoriteHarnessDefault({ favorites: ordered, availableHarnesses: installed, blocked: false })
    ).toBe(PI);
  });

  test('returns null when no favourite harness is installed', () => {
    expect(
      favoriteHarnessDefault({
        favorites: [entry(CURSOR, 'c1')],
        availableHarnesses: installed,
        blocked: false,
      })
    ).toBeNull();
  });

  test('returns null for an empty favourites list', () => {
    expect(
      favoriteHarnessDefault({ favorites: [], availableHarnesses: installed, blocked: false })
    ).toBeNull();
  });

  test('returns null when blocked, even with a usable favourite', () => {
    expect(
      favoriteHarnessDefault({ favorites, availableHarnesses: installed, blocked: true })
    ).toBeNull();
  });
});

describe('pickFavoriteModelForHarness', () => {
  test('returns the first favourite model for the harness that is visible', () => {
    const favorites = [entry(PI, 'p1'), entry(OPENCODE, 'hidden'), entry(OPENCODE, 'm2')];
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
    expect(pickFavoriteModelForHarness([entry(PI, 'm2')], OPENCODE, ['m2'])).toBeUndefined();
  });
});
