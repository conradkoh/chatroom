import { describe, expect, it } from 'vitest';

import { excludeActiveSelection, findExactMatches } from './findExactMatches';

describe('findExactMatches', () => {
  it('returns empty array for empty needle', () => {
    expect(findExactMatches('hello', '')).toEqual([]);
  });

  it('finds all exact matches', () => {
    expect(findExactMatches('foo bar foo', 'foo')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('is case-sensitive', () => {
    expect(findExactMatches('Foo foo', 'foo')).toEqual([{ start: 4, end: 7 }]);
  });

  it('includes overlapping matches', () => {
    expect(findExactMatches('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 1, end: 3 },
      { start: 2, end: 4 },
    ]);
  });

  it('handles regex-special characters literally', () => {
    expect(findExactMatches('a.b+a?', 'a.b')).toEqual([{ start: 0, end: 3 }]);
  });

  it('handles unicode text', () => {
    expect(findExactMatches('café café', 'café')).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ]);
  });

  it('returns empty array when needle exceeds max length', () => {
    const needle = 'a'.repeat(201);
    expect(findExactMatches(`${needle}x`, needle)).toEqual([]);
  });
});

describe('excludeActiveSelection', () => {
  it('removes the range that matches the active selection', () => {
    const matches = [
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ];
    expect(excludeActiveSelection(matches, { start: 0, end: 3 })).toEqual([{ start: 8, end: 11 }]);
  });

  it('returns all matches when selection is null', () => {
    const matches = [{ start: 0, end: 3 }];
    expect(excludeActiveSelection(matches, null)).toEqual(matches);
  });
});
