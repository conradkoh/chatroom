import { describe, expect, it } from 'vitest';
import { readLogFiltersFromSearch, writeLogFiltersToSearch } from './log-filters-url.js';
describe('log-filters-url', () => {
  it('reads filters', () =>
    expect(
      readLogFiltersFromSearch('?chatroomId=room1&role=planner&harness=cursor-sdk&timeRange=3h')
    ).toEqual({ chatroomId: 'room1', role: 'planner', harness: 'cursor-sdk', timeRange: '3h' }));
  it('reads custom', () =>
    expect(readLogFiltersFromSearch('?timeRange=custom&from=100&to=200')).toEqual({
      timeRange: 'custom',
      fromMs: 100,
      toMs: 200,
    }));
  it('round trips preset', () =>
    expect(
      readLogFiltersFromSearch(`?${writeLogFiltersToSearch({ chatroomId: 'r1', timeRange: '1d' })}`)
    ).toEqual({ chatroomId: 'r1', timeRange: '1d' }));
  it('writes custom', () =>
    expect(writeLogFiltersToSearch({ timeRange: 'custom', fromMs: 500, toMs: 900 })).toContain(
      'from=500'
    ));
  it('ignores invalid', () => expect(readLogFiltersFromSearch('?timeRange=invalid')).toEqual({}));
});
