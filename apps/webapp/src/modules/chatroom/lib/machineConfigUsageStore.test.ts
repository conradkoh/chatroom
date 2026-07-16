import { afterEach, describe, expect, test } from 'vitest';

import { MachineConfigUsageStore } from './machineConfigUsageStore';

const SCOPE_A = 'm1|chatroom_r1#team_duo#role_planner';
const SCOPE_B = 'm1|chatroom_r1#team_duo#role_builder';

describe('MachineConfigUsageStore', () => {
  let store: MachineConfigUsageStore;

  afterEach(() => {
    store.clear();
  });

  test('records and retrieves usage', () => {
    store = new MachineConfigUsageStore();
    store.recordUsage(SCOPE_A, { agentHarness: 'opencode-sdk' as any, model: 'gpt-4' });
    const usage = store.getAllUsageForScope(SCOPE_A);
    expect(usage.has('opencode-sdk|gpt-4')).toBe(true);
    expect(usage.get('opencode-sdk|gpt-4')?.length).toBe(1);
  });

  test('clearUsage removes entry', () => {
    store = new MachineConfigUsageStore();
    const entry = { agentHarness: 'opencode-sdk' as any, model: 'gpt-4' };
    store.recordUsage(SCOPE_A, entry);
    store.clearUsage(SCOPE_A, entry);
    expect(store.getAllUsageForScope(SCOPE_A).has('opencode-sdk|gpt-4')).toBe(false);
  });

  test('getTimestamps returns empty for unknown entry', () => {
    store = new MachineConfigUsageStore();
    const timestamps = store.getTimestamps('unknown', {
      agentHarness: 'opencode-sdk' as any,
      model: 'nonexistent',
    });
    expect(timestamps).toEqual([]);
  });

  test('scopes are isolated', () => {
    store = new MachineConfigUsageStore();
    const entry = { agentHarness: 'opencode-sdk' as any, model: 'gpt-4' };
    store.recordUsage(SCOPE_A, entry);
    expect(store.getAllUsageForScope(SCOPE_B).has('opencode-sdk|gpt-4')).toBe(false);
    expect(
      store.getAllUsageForScope('m2|chatroom_r1#team_duo#role_planner').has('opencode-sdk|gpt-4')
    ).toBe(false);
  });
});
