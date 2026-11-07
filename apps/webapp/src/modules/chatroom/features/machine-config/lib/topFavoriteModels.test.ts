import { describe, expect, it } from 'vitest';

import {
  describeApplyTopFavoritesResult,
  resolveTopFavoritePerRole,
  type ApplyTopFavoritesResult,
} from './topFavoriteModels';

const plannerTop = { agentHarness: 'claude' as const, model: 'opus' };
const builderTop = { agentHarness: 'opencode' as const, model: 'gpt' };

describe('resolveTopFavoritePerRole', () => {
  it('picks index 0, skips empty lists and skips roles missing from the map', () => {
    const favoritesByRole = new Map([
      [
        'planner',
        [
          { agentHarness: 'claude' as const, model: 'opus' },
          { agentHarness: 'opencode' as const, model: 'gpt' },
        ],
      ],
      ['builder', []],
    ]);

    expect(resolveTopFavoritePerRole(['planner', 'builder', 'reviewer'], favoritesByRole)).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude', model: 'opus' } },
    ]);
  });

  it('keeps the order of roles, not the order of the map', () => {
    const favoritesByRole = new Map([
      ['builder', [builderTop]],
      ['planner', [plannerTop]],
    ]);

    expect(resolveTopFavoritePerRole(['planner', 'builder'], favoritesByRole)).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude', model: 'opus' } },
      { role: 'builder', entry: { agentHarness: 'opencode', model: 'gpt' } },
    ]);
  });
});

describe('describeApplyTopFavoritesResult', () => {
  it('reports success when every role applied', () => {
    const result: ApplyTopFavoritesResult = {
      applied: [
        { role: 'planner', entry: plannerTop },
        { role: 'builder', entry: builderTop },
      ],
      failed: [],
    };

    expect(describeApplyTopFavoritesResult(result)).toEqual({
      kind: 'success',
      message: 'Applied top favourite model to 2 agent(s). Restart agents to use it.',
    });
  });

  it('reports a partial failure with the count of other agents applied', () => {
    const result: ApplyTopFavoritesResult = {
      applied: [{ role: 'builder', entry: builderTop }],
      failed: [{ role: 'planner', message: 'boom' }],
    };

    expect(describeApplyTopFavoritesResult(result)).toEqual({
      kind: 'error',
      message:
        'Failed to apply top favourite model for planner (boom). Applied to 1 other agent(s).',
    });
  });

  it('reports every failure when nothing applied', () => {
    const result: ApplyTopFavoritesResult = {
      applied: [],
      failed: [
        { role: 'planner', message: 'a' },
        { role: 'builder', message: 'b' },
      ],
    };

    expect(describeApplyTopFavoritesResult(result)).toEqual({
      kind: 'error',
      message: 'Failed to apply top favourite model for planner (a), builder (b)',
    });
  });
});
