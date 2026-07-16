import { afterEach, describe, expect, test } from 'vitest';

import { MachineConfigUsageStore } from './machineConfigUsageStore';

describe('MachineConfigUsageStore', () => {
  let store: MachineConfigUsageStore;

  afterEach(() => {
    store.clear();
  });

  test('records and retrieves usage', () => {
    store = new MachineConfigUsageStore();
    store.recordUsage('machine-1', { agentHarness: 'opencode-sdk' as any, model: 'gpt-4' });
    const usage = store.getAllUsageForMachine('machine-1');
    expect(usage.has('opencode-sdk|gpt-4')).toBe(true);
    expect(usage.get('opencode-sdk|gpt-4')?.length).toBe(1);
  });

  test('clearUsage removes entry', () => {
    store = new MachineConfigUsageStore();
    const entry = { agentHarness: 'opencode-sdk' as any, model: 'gpt-4' };
    store.recordUsage('machine-1', entry);
    store.clearUsage('machine-1', entry);
    expect(store.getAllUsageForMachine('machine-1').has('opencode-sdk|gpt-4')).toBe(false);
  });

  test('getTimestamps returns empty for unknown entry', () => {
    store = new MachineConfigUsageStore();
    const timestamps = store.getTimestamps('machine-x', {
      agentHarness: 'opencode-sdk' as any,
      model: 'nonexistent',
    });
    expect(timestamps).toEqual([]);
  });
});
