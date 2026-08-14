import { describe, expect, it } from 'vitest';

import { hasEnhancerConfigFields, isEnhancerConfigActive } from './enhancer';

const config = {
  enabled: true,
  targetId: 'handoff:planner-to-builder' as const,
  agentHarness: 'opencode' as const,
  model: 'model',
  machineId: 'machine',
};

describe('enhancer config predicates', () => {
  it('rejects whitespace model and machine values', () => {
    expect(isEnhancerConfigActive({ ...config, model: ' ' })).toBe(false);
    expect(hasEnhancerConfigFields({ ...config, machineId: ' ' })).toBe(false);
  });

  it('accepts complete fields regardless of enabled state', () => {
    expect(hasEnhancerConfigFields({ ...config, enabled: false })).toBe(true);
    expect(isEnhancerConfigActive(config)).toBe(true);
  });
});
