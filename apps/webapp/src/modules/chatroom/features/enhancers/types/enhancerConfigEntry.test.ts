import { describe, expect, test } from 'vitest';

import {
  buildEnhancerConfigKey,
  enhancerConfigEntriesEqual,
  filterFavoritesForTarget,
  isEnhancerConfigFavoriteForTarget,
} from './enhancerConfigEntry';

describe('enhancerConfigEntry', () => {
  test('buildEnhancerConfigKey joins target, harness, and model', () => {
    expect(
      buildEnhancerConfigKey({
        targetId: 'handoff:planner-to-builder',
        agentHarness: 'opencode',
        model: 'anthropic/claude-opus-4',
      })
    ).toBe('handoff:planner-to-builder|opencode|anthropic/claude-opus-4');
  });

  test('enhancerConfigEntriesEqual matches same fields', () => {
    const a = {
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'opencode' as const,
      model: 'gpt-4',
    };
    const b = {
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'opencode' as const,
      model: 'gpt-4',
    };
    expect(enhancerConfigEntriesEqual(a, b)).toBe(true);
  });

  test('enhancerConfigEntriesEqual rejects different model', () => {
    const a = {
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'opencode' as const,
      model: 'gpt-4',
    };
    const b = {
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'opencode' as const,
      model: 'claude',
    };
    expect(enhancerConfigEntriesEqual(a, b)).toBe(false);
  });

  test('filterFavoritesForTarget includes entries missing targetId for default target', () => {
    const favorites = [
      {
        targetId: undefined as unknown as 'handoff:planner-to-builder',
        agentHarness: 'opencode' as const,
        model: 'gpt-4',
      },
    ];
    expect(filterFavoritesForTarget(favorites, 'handoff:planner-to-builder')).toHaveLength(1);
  });

  test('isEnhancerConfigFavoriteForTarget matches harness and model within target', () => {
    const favorites = [
      {
        targetId: 'handoff:planner-to-builder' as const,
        agentHarness: 'opencode' as const,
        model: 'gpt-4',
      },
    ];
    expect(
      isEnhancerConfigFavoriteForTarget(
        favorites,
        { agentHarness: 'opencode', model: 'gpt-4' },
        'handoff:planner-to-builder'
      )
    ).toBe(true);
  });
});
