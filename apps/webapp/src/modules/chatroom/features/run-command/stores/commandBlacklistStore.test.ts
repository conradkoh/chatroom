import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCommandBlacklistStore, migrateKey } from './commandBlacklistStore';

describe('CommandBlacklistStore', () => {
  let store: ReturnType<typeof getCommandBlacklistStore>;

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    });
    store = getCommandBlacklistStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts empty', () => {
    expect(store.has('cmd-1')).toBe(false);
    expect(store.getAll().size).toBe(0);
  });

  it('adds and checks command', () => {
    store.add('cmd-1');
    expect(store.has('cmd-1')).toBe(true);
  });

  it('removes command', () => {
    store.add('cmd-1');
    store.remove('cmd-1');
    expect(store.has('cmd-1')).toBe(false);
  });

  it('adding same id twice is idempotent', () => {
    store.add('cmd-1');
    store.add('cmd-1');
    expect(store.getAll().size).toBe(1);
  });

  it('clear removes all entries', () => {
    store.add('cmd-1');
    store.add('cmd-2');
    store.clear();
    expect(store.getAll().size).toBe(0);
  });

  it('getAll returns all blacklisted IDs', () => {
    store.add('cmd-1');
    store.add('cmd-2');
    const all = store.getAll();
    expect(all.has('cmd-1')).toBe(true);
    expect(all.has('cmd-2')).toBe(true);
    expect(all.size).toBe(2);
  });
});

describe('migrateKey', () => {
  it('strips workspace id from legacy workspace keys', () => {
    expect(migrateKey('ws-abc123def456-open-vscode')).toBe('ws-open-vscode');
  });

  it('passes through built-in keys unchanged', () => {
    expect(migrateKey('nav-go-to-file')).toBe('nav-go-to-file');
  });

  it('passes through already-migrated keys unchanged', () => {
    expect(migrateKey('ws-open-vscode')).toBe('ws-open-vscode');
  });
});
