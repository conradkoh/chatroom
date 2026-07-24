import { describe, expect, it } from 'vitest';

import {
  formatEnhancerConfigLabel,
  formatEnhancerHarnessModelLabel,
  formatEnhancerHarnessModelLabelDisplay,
} from './formatEnhancerConfigLabel';

const entry = {
  targetId: 'handoff:planner-to-builder' as const,
  agentHarness: 'opencode' as const,
  model: 'anthropic/claude-opus-4',
};

describe('formatEnhancerConfigLabel', () => {
  it('formatEnhancerHarnessModelLabel returns harness and model only', () => {
    expect(formatEnhancerHarnessModelLabel(entry)).toBe(
      'OpenCode (CLI) / ANTHROPIC / CLAUDE OPUS 4'
    );
  });

  it('formatEnhancerConfigLabel includes target prefix', () => {
    expect(formatEnhancerConfigLabel(entry)).toBe(
      'Handoff: Planner → Builder / OpenCode (CLI) / ANTHROPIC / CLAUDE OPUS 4'
    );
  });

  it('formatEnhancerHarnessModelLabelDisplay truncates long labels at 40 characters', () => {
    const truncated = formatEnhancerHarnessModelLabelDisplay({
      agentHarness: 'opencode',
      model: 'minimax/MiniMax-M2.5-highspeed',
    });
    expect(truncated.endsWith('...')).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(43);
    expect(truncated.startsWith('OpenCode')).toBe(true);
  });
});
