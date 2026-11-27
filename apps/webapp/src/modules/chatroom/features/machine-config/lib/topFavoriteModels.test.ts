import { describe, expect, it } from 'vitest';

import {
  describeApplyTopFavoritesResult,
  resolveTopFavoritePerRole,
  type ApplyTopFavoritesResult,
} from './topFavoriteModels';

const plannerTop = { agentHarness: 'claude-sdk' as const, model: 'opus' };
const builderTop = { agentHarness: 'opencode-sdk' as const, model: 'gpt' };

describe('resolveTopFavoritePerRole', () => {
  it('picks index 0, skips empty lists and skips roles missing from the map', () => {
    const favoritesByRole = new Map([
      [
        'planner',
        [
          { agentHarness: 'claude-sdk' as const, model: 'opus' },
          { agentHarness: 'opencode-sdk' as const, model: 'gpt' },
        ],
      ],
      ['builder', []],
    ]);

    expect(resolveTopFavoritePerRole(['planner', 'builder', 'reviewer'], favoritesByRole)).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude-sdk', model: 'opus' } },
    ]);
  });

  it('keeps the order of roles, not the order of the map', () => {
    const favoritesByRole = new Map([
      ['builder', [builderTop]],
      ['planner', [plannerTop]],
    ]);

    expect(resolveTopFavoritePerRole(['planner', 'builder'], favoritesByRole)).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude-sdk', model: 'opus' } },
      { role: 'builder', entry: { agentHarness: 'opencode-sdk', model: 'gpt' } },
    ]);
  });
});

describe('describeApplyTopFavoritesResult', () => {
  it('reports success with restarted and saved counts', () => {
    const result: ApplyTopFavoritesResult = {
      applied: [
        { role: 'planner', entry: plannerTop, outcome: 'restarted' },
        { role: 'builder', entry: builderTop, outcome: 'saved' },
        { role: 'reviewer', entry: builderTop, outcome: 'unchanged' },
      ],
      failed: [],
    };

    expect(describeApplyTopFavoritesResult(result)).toEqual({
      kind: 'success',
      message:
        'Applied top favourite model to 3 agent(s): 1 restarted, 1 saved (not running), 1 already up to date.',
    });
  });

  it('reports two restarted agents', () => {
    const result: ApplyTopFavoritesResult = {
      applied: [
        { role: 'planner', entry: plannerTop, outcome: 'restarted' },
        { role: 'builder', entry: builderTop, outcome: 'restarted' },
      ],
      failed: [],
    };

    expect(describeApplyTopFavoritesResult(result)).toEqual({
      kind: 'success',
      message: 'Applied top favourite model to 2 agent(s): 2 restarted.',
    });
  });

  it('reports when every agent is already up to date', () => {
    const result: ApplyTopFavoritesResult = {
      applied: [
        { role: 'planner', entry: plannerTop, outcome: 'unchanged' },
        { role: 'builder', entry: builderTop, outcome: 'unchanged' },
      ],
      failed: [],
    };

    expect(describeApplyTopFavoritesResult(result)).toEqual({
      kind: 'success',
      message: 'Every agent already uses its top favourite model.',
    });
  });

  it('reports a partial failure with the outcome breakdown of other agents', () => {
    const result: ApplyTopFavoritesResult = {
      applied: [{ role: 'builder', entry: builderTop, outcome: 'restarted' }],
      failed: [{ role: 'planner', message: 'boom' }],
    };

    expect(describeApplyTopFavoritesResult(result)).toEqual({
      kind: 'error',
      message:
        'Failed to apply top favourite model for planner (boom). Applied to 1 other agent(s): 1 restarted.',
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
