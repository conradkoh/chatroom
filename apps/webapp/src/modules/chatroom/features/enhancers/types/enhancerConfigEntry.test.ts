import { describe, expect, test } from 'vitest';

import { buildEnhancerConfigKey, enhancerConfigEntriesEqual } from './enhancerConfigEntry';

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
});
