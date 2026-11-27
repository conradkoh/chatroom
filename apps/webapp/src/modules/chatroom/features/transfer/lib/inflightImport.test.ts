import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearInflightImport,
  INFLIGHT_IMPORT_STALE_MS,
  INFLIGHT_IMPORT_STORAGE_KEY,
  isStaleInflightImport,
  readInflightImport,
  touchInflightImport,
  writeInflightImport,
} from './inflightImport';

const START = 1_000_000;

describe('inflight import record', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('round-trips a written record', () => {
    writeInflightImport('chatroom-1', START);
    expect(readInflightImport()).toEqual({
      chatroomId: 'chatroom-1',
      startedAt: START,
      heartbeatAt: START,
    });
    expect(JSON.parse(window.localStorage.getItem(INFLIGHT_IMPORT_STORAGE_KEY) ?? '{}')).toEqual({
      chatroomId: 'chatroom-1',
      startedAt: START,
      heartbeatAt: START,
    });
  });

  it('refreshes only the heartbeat on touch', () => {
    writeInflightImport('chatroom-1', START);
    touchInflightImport(START + 5_000);
    expect(readInflightImport()).toEqual({
      chatroomId: 'chatroom-1',
      startedAt: START,
      heartbeatAt: START + 5_000,
    });
  });

  it('does nothing on touch when no record exists', () => {
    touchInflightImport(START);
    expect(readInflightImport()).toBeNull();
    expect(window.localStorage.getItem(INFLIGHT_IMPORT_STORAGE_KEY)).toBeNull();
  });

  it('clears the record', () => {
    writeInflightImport('chatroom-1', START);
    clearInflightImport();
    expect(readInflightImport()).toBeNull();
  });

  it('returns null for corrupt JSON and for records with missing fields', () => {
    window.localStorage.setItem(INFLIGHT_IMPORT_STORAGE_KEY, 'not json');
    expect(readInflightImport()).toBeNull();
    window.localStorage.setItem(INFLIGHT_IMPORT_STORAGE_KEY, JSON.stringify({ chatroomId: 'x' }));
    expect(readInflightImport()).toBeNull();
    window.localStorage.setItem(
      INFLIGHT_IMPORT_STORAGE_KEY,
      JSON.stringify({ chatroomId: 'x', startedAt: 'soon', heartbeatAt: 1 })
    );
    expect(readInflightImport()).toBeNull();
  });

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => readInflightImport()).not.toThrow();
    expect(readInflightImport()).toBeNull();
  });

  it('is stale only after the heartbeat is older than the stale window', () => {
    const record = { chatroomId: 'x', startedAt: START, heartbeatAt: START };
    expect(isStaleInflightImport(record, START + INFLIGHT_IMPORT_STALE_MS)).toBe(false);
    expect(isStaleInflightImport(record, START + INFLIGHT_IMPORT_STALE_MS + 1)).toBe(true);
  });
});
