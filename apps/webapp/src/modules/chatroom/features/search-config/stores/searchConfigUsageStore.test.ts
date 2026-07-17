import { afterEach, describe, expect, test } from 'vitest';
import { SearchConfigUsageStore } from './searchConfigUsageStore';

describe('SearchConfigUsageStore', () => {
  let store: SearchConfigUsageStore;

  afterEach(() => {
    store.clear();
  });

  test('records and retrieves usage', () => {
    store = new SearchConfigUsageStore();
    store.recordUsage('machine-1', { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' });
    const usage = store.getAllUsageForScope('machine-1');
    expect(usage.has('opencode-sdk|openai::gpt-4o')).toBe(true);
    expect(usage.get('opencode-sdk|openai::gpt-4o')?.length).toBe(1);
  });

  test('clearUsage removes entry', () => {
    store = new SearchConfigUsageStore();
    const entry = { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' };
    store.recordUsage('machine-1', entry);
    store.clearUsage('machine-1', entry);
    expect(store.getAllUsageForScope('machine-1').has('opencode-sdk|openai::gpt-4o')).toBe(false);
  });

  test('scopes isolate different machineIds', () => {
    store = new SearchConfigUsageStore();
    store.recordUsage('machine-a', { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' });
    expect(store.getAllUsageForScope('machine-b').size).toBe(0);
  });

  test('prunes old timestamps', () => {
    store = new SearchConfigUsageStore();
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    // Directly set an old timestamp via the internal data
    (store as any).data.scopes['m1'] = { 'opencode-sdk|openai::gpt-4o': [old] };
    (store as any).save();
    const store2 = new SearchConfigUsageStore();
    expect(store2.getAllUsageForScope('m1').size).toBe(0);
  });
});
