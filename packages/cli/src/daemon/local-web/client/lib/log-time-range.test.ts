import { describe, expect, it } from 'vitest';
import { resolveTimeRange, fromDatetimeLocalValue } from './log-time-range';
describe('log time range', () => {
  it('defaults to one hour', () => {
    expect(resolveTimeRange({}, 3600000)).toEqual({ fromMs: 0, toMs: 3600000 });
  });
  it('supports custom', () => {
    expect(resolveTimeRange({ timeRange: 'custom', fromMs: 10, toMs: 20 }, 100)).toEqual({
      fromMs: 10,
      toMs: 20,
    });
  });
  it('parses datetime local', () => {
    expect(fromDatetimeLocalValue('2020-01-01T00:00')).toBeTypeOf('number');
  });
});
