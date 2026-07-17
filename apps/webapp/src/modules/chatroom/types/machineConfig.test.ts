import { describe, expect, test } from 'vitest';

import { buildMachineConfigKey, entriesEqual } from './machineConfig';

describe('machineConfig', () => {
  test('buildMachineConfigKey joins harness and model', () => {
    expect(buildMachineConfigKey({ agentHarness: 'opencode-sdk', model: 'claude-sonnet' })).toBe(
      'opencode-sdk|claude-sonnet'
    );
  });

  test('entriesEqual matches same harness and model', () => {
    const a = { agentHarness: 'opencode-sdk' as const, model: 'gpt-4' };
    const b = { agentHarness: 'opencode-sdk' as const, model: 'gpt-4' };
    expect(entriesEqual(a, b)).toBe(true);
  });

  test('entriesEqual rejects different model', () => {
    const a = { agentHarness: 'opencode-sdk' as const, model: 'gpt-4' };
    const b = { agentHarness: 'opencode-sdk' as const, model: 'claude' };
    expect(entriesEqual(a, b)).toBe(false);
  });
});
