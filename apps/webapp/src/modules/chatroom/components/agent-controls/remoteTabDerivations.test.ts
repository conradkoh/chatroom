import { describe, expect, it, vi } from 'vitest';

import {
  currentIsFavorite,
  deriveDisplayValues,
  deriveHarnessDisabled,
  deriveModelUnavailable,
  deriveModelWarning,
  deriveRecommendedConfigs,
  isDaemonConnected,
  shouldShowSelectHint,
  type RemoteFormValues,
} from './remoteTabDerivations';
import type { AgentConfig, AgentHarness } from '../../types/machine';

const form: RemoteFormValues = {
  machineId: 'a',
  harness: 'cursor',
  model: 'm1',
  workingDir: '/form',
};

function mkConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    machineId: 'b',
    hostname: 'host-b',
    role: 'builder',
    agentType: 'opencode',
    availableHarnesses: ['opencode'],
    workingDir: '/running',
    updatedAt: 1,
    model: 'm9',
    ...overrides,
  };
}

describe('deriveDisplayValues', () => {
  it('shows the form state when no agent runs', () => {
    expect(deriveDisplayValues(undefined, form)).toBe(form);
  });

  it('shows the running agent while one runs', () => {
    expect(deriveDisplayValues(mkConfig(), form)).toEqual({
      machineId: 'b',
      harness: 'opencode',
      model: 'm9',
      workingDir: '/running',
    });
  });

  it('keeps the form model when the running agent has none', () => {
    expect(deriveDisplayValues(mkConfig({ model: undefined }), form).model).toBe('m1');
  });
});

describe('deriveModelUnavailable', () => {
  it('is unavailable without a machine', () => {
    expect(deriveModelUnavailable(null, 'cursor', true)).toBe(true);
  });

  it('is unavailable without a harness', () => {
    expect(deriveModelUnavailable('a', null, true)).toBe(true);
  });

  it('is unavailable when the harness has no models', () => {
    expect(deriveModelUnavailable('a', 'cursor', false)).toBe(true);
  });

  it('is available with a machine, a harness and models', () => {
    expect(deriveModelUnavailable('a', 'cursor', true)).toBe(false);
  });
});

describe('deriveHarnessDisabled', () => {
  it('is disabled while busy', () => {
    expect(deriveHarnessDisabled(true, 'a', 2)).toBe(true);
  });

  it('is disabled without a machine', () => {
    expect(deriveHarnessDisabled(false, null, 2)).toBe(true);
  });

  it('is disabled when the machine has no harnesses', () => {
    expect(deriveHarnessDisabled(false, 'a', 0)).toBe(true);
  });

  it('is enabled when idle with a machine that has harnesses', () => {
    expect(deriveHarnessDisabled(false, 'a', 2)).toBe(false);
  });
});

describe('deriveModelWarning', () => {
  it('warns when a model the machine filter hides is selected and available', () => {
    expect(deriveModelWarning(false, true)).toBe(true);
  });

  it('does not warn for a visible model', () => {
    expect(deriveModelWarning(false, false)).toBe(false);
  });

  it('does not warn when no model is available, even if the selection is hidden', () => {
    expect(deriveModelWarning(true, true)).toBe(false);
  });
});

describe('shouldShowSelectHint', () => {
  const idle = {
    setupMode: false,
    isAgentRunning: false,
    selectedMachineId: null as string | null,
    connectedCount: 2,
    isLoadingMachines: false,
  };

  it('asks for a machine when machines exist and none is selected', () => {
    expect(shouldShowSelectHint(idle)).toBe(true);
  });

  it('is hidden in the setup wizard', () => {
    expect(shouldShowSelectHint({ ...idle, setupMode: true })).toBe(false);
  });

  it('is hidden while an agent runs', () => {
    expect(shouldShowSelectHint({ ...idle, isAgentRunning: true })).toBe(false);
  });

  it('is hidden once a machine is selected', () => {
    expect(shouldShowSelectHint({ ...idle, selectedMachineId: 'a' })).toBe(false);
  });

  it('is hidden when no machine is connected', () => {
    expect(shouldShowSelectHint({ ...idle, connectedCount: 0 })).toBe(false);
  });

  it('is hidden while machines load', () => {
    expect(shouldShowSelectHint({ ...idle, isLoadingMachines: true })).toBe(false);
  });
});

describe('currentIsFavorite', () => {
  it('is false without a current entry, and does not ask the favourites', () => {
    const isFavorite = vi.fn(() => true);
    expect(currentIsFavorite(null, isFavorite)).toBe(false);
    expect(isFavorite).not.toHaveBeenCalled();
  });

  it('asks the favourites about the current entry', () => {
    const entry = { agentHarness: 'cursor' as AgentHarness, model: 'm1' };
    const isFavorite = vi.fn((e: typeof entry) => e.model === 'm1');
    expect(currentIsFavorite(entry, isFavorite)).toBe(true);
    expect(isFavorite).toHaveBeenCalledWith(entry);
  });
});

describe('deriveRecommendedConfigs', () => {
  const now = Date.now();
  const args = {
    scopeKey: 'scope',
    usage: new Map<string, number[]>(),
    favorites: [] as { agentHarness: AgentHarness; model: string }[],
    availableHarnesses: ['cursor'] as AgentHarness[],
    displayHarness: null as AgentHarness | null,
    displayModel: null as string | null,
  };

  it('is empty without a scope', () => {
    expect(deriveRecommendedConfigs({ ...args, scopeKey: undefined })).toEqual([]);
  });

  it('leaves out a favourite, since favourites are shown on their own', () => {
    const favorites = [{ agentHarness: 'cursor' as AgentHarness, model: 'm1' }];
    const usage = new Map([['cursor|m1', [now]]]);
    const result = deriveRecommendedConfigs({ ...args, favorites, usage });
    expect(result).not.toContainEqual({ agentHarness: 'cursor', model: 'm1' });
  });

  it('recommends the displayed config only once it has recent usage', () => {
    const display = { ...args, displayHarness: 'cursor' as AgentHarness, displayModel: 'm3' };
    expect(deriveRecommendedConfigs(display)).toEqual([]);
    const used = new Map([['cursor|m3', [now]]]);
    expect(deriveRecommendedConfigs({ ...display, usage: used })).toContainEqual({
      agentHarness: 'cursor',
      model: 'm3',
    });
  });

  it('includes recent usage on an installed harness, and leaves out usage on a missing one', () => {
    const usage = new Map<string, number[]>([
      ['cursor|m2', [now]],
      ['claude|m5', [now]],
    ]);
    const result = deriveRecommendedConfigs({ ...args, usage });
    expect(result).toContainEqual({ agentHarness: 'cursor', model: 'm2' });
    expect(result).not.toContainEqual({ agentHarness: 'claude', model: 'm5' });
  });

  it('caps the recommendations at three', () => {
    const usage = new Map<string, number[]>([
      ['cursor|m1', [now]],
      ['cursor|m2', [now]],
      ['cursor|m3', [now]],
      ['cursor|m4', [now]],
    ]);
    expect(deriveRecommendedConfigs({ ...args, usage })).toHaveLength(3);
  });
});

describe('isDaemonConnected', () => {
  it('is false without a connectivity map', () => {
    expect(isDaemonConnected(undefined, 'a')).toBe(false);
  });

  it('is false for a machine the map does not list', () => {
    expect(isDaemonConnected(new Map(), 'a')).toBe(false);
  });

  it('is true only for a machine reported connected', () => {
    const map = new Map([
      ['a', { connected: true }],
      ['b', { connected: false }],
    ]);
    expect(isDaemonConnected(map, 'a')).toBe(true);
    expect(isDaemonConnected(map, 'b')).toBe(false);
  });
});
