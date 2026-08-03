import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  getCommandUsageRevision,
  getCommandUsageStore,
  subscribeCommandUsage,
} from './commandUsageStore';

const DAY = 24 * 60 * 60 * 1000;

describe('CommandUsageStore', () => {
  beforeEach(() => {
    localStorage.clear();
    getCommandUsageStore().clear();
  });

  test('getAllUsage returns only non-expired timestamps and does not throw', () => {
    const store = getCommandUsageStore();
    const expired = Date.now() - 31 * DAY;
    const recent = Date.now() - 60 * 60 * 1000;
    (store as any).data.commands = {
      'cmd-stale': [expired],
      'cmd-fresh': [recent],
    };

    const usage = store.getAllUsage();

    expect(usage.has('cmd-stale')).toBe(false);
    expect(usage.get('cmd-fresh')).toEqual([recent]);
  });

  test('getAllUsage prunes expired entries in memory immediately', () => {
    const store = getCommandUsageStore();
    const expired = Date.now() - 31 * DAY;
    (store as any).data.commands = {
      'cmd-stale': [expired],
      'cmd-fresh': [Date.now()],
    };

    store.getAllUsage();

    expect(store.getAllUsage().has('cmd-stale')).toBe(false);
  });

  test('getAllUsage does not synchronously emit when pruning expired data', () => {
    const store = getCommandUsageStore();
    const expired = Date.now() - 31 * DAY;
    (store as any).data.commands = { 'cmd-stale': [expired] };
    const listener = vi.fn();
    const unsubscribe = subscribeCommandUsage(listener);
    const revisionBefore = getCommandUsageRevision();

    store.getAllUsage();

    expect(listener).not.toHaveBeenCalled();
    expect(getCommandUsageRevision()).toBe(revisionBefore);
    unsubscribe();
  });

  test('getAllUsage with no stale entries does not emit at all', () => {
    const store = getCommandUsageStore();
    store.recordUsage('cmd-fresh');
    const listener = vi.fn();
    const unsubscribe = subscribeCommandUsage(listener);
    const revisionBefore = getCommandUsageRevision();

    store.getAllUsage();

    expect(listener).not.toHaveBeenCalled();
    expect(getCommandUsageRevision()).toBe(revisionBefore);
    unsubscribe();
  });

  test('pruned data is persisted and emitted asynchronously after a microtask', async () => {
    const store = getCommandUsageStore();
    const expired = Date.now() - 31 * DAY;
    (store as any).data.commands = { 'cmd-stale': [expired] };
    const listener = vi.fn();
    const unsubscribe = subscribeCommandUsage(listener);
    const revisionBefore = getCommandUsageRevision();

    store.getAllUsage();

    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCommandUsageRevision()).toBe(revisionBefore + 1);
    expect(JSON.parse(localStorage.getItem('chatroom:command-usage') ?? '{}').commands).toEqual({});
    unsubscribe();
  });

  test('recordUsage still emits synchronously', () => {
    const store = getCommandUsageStore();
    const listener = vi.fn();
    const unsubscribe = subscribeCommandUsage(listener);

    store.recordUsage('cmd-1');

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
