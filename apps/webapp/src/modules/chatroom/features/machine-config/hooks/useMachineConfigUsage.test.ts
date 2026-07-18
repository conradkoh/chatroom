import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useMachineConfigUsage } from './useMachineConfigUsage';
import { getMachineConfigUsageStore } from '../stores/machineConfigUsageStore';

const SCOPE = 'm1|team_duo#role_planner';

describe('useMachineConfigUsage', () => {
  afterEach(() => {
    getMachineConfigUsageStore().clear();
  });

  it('returns empty usage when scopeKey is undefined', () => {
    const { result } = renderHook(() => useMachineConfigUsage(undefined));
    expect(result.current.usageForScope.size).toBe(0);
  });

  it('recordUsage updates usageForScope reactively', () => {
    const { result } = renderHook(() => useMachineConfigUsage(SCOPE));

    act(() => {
      result.current.recordUsage({ agentHarness: 'opencode-sdk' as any, model: 'gpt-4' });
    });

    expect(result.current.usageForScope.has('opencode-sdk|gpt-4')).toBe(true);
  });

  it('clearUsage removes usage reactively', () => {
    const entry = { agentHarness: 'opencode-sdk' as any, model: 'gpt-4' };
    const { result } = renderHook(() => useMachineConfigUsage(SCOPE));

    act(() => {
      result.current.recordUsage(entry);
    });
    act(() => {
      result.current.clearUsage(entry);
    });

    expect(result.current.usageForScope.has('opencode-sdk|gpt-4')).toBe(false);
  });
});
