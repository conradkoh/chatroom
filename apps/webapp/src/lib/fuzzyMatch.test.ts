import { describe, expect, it } from 'vitest';

import { fuzzyMatch, fuzzyFilter } from './fuzzyMatch';

describe('fuzzyMatch', () => {
  it('returns > 0 for exact match', () => {
    expect(fuzzyMatch('hello', 'hello')).toBeGreaterThan(0);
  });

  it('returns 0 for no match', () => {
    expect(fuzzyMatch('xyz', 'hello')).toBe(0);
  });

  it('returns > 0 for empty query (matches everything)', () => {
    expect(fuzzyMatch('', 'anything')).toBeGreaterThan(0);
  });

  it('returns 0 for empty target with non-empty query', () => {
    expect(fuzzyMatch('a', '')).toBe(0);
  });

  it('matches characters in order (non-contiguous)', () => {
    expect(fuzzyMatch('cmd', 'CommandPalette')).toBeGreaterThan(0);
  });

  it('is case insensitive', () => {
    expect(fuzzyMatch('CMD', 'CommandPalette')).toBeGreaterThan(0);
    expect(fuzzyMatch('cmd', 'COMMANDPALETTE')).toBeGreaterThan(0);
  });

  it('fails when characters are out of order', () => {
    expect(fuzzyMatch('dcb', 'abcd')).toBe(0);
  });

  it('scores prefix matches higher than non-prefix', () => {
    const prefixScore = fuzzyMatch('com', 'CommandPalette');
    const nonPrefixScore = fuzzyMatch('pal', 'CommandPalette');
    expect(prefixScore).toBeGreaterThan(nonPrefixScore);
  });

  it('scores consecutive matches higher than spread matches', () => {
    const consecutiveScore = fuzzyMatch('abc', 'abcdef');
    const spreadScore = fuzzyMatch('abc', 'axbxcx');
    expect(consecutiveScore).toBeGreaterThan(spreadScore);
  });

  it('handles path matching', () => {
    expect(fuzzyMatch('fm', 'src/lib/fuzzyMatch.ts')).toBeGreaterThan(0);
    expect(fuzzyMatch('fuzzy', 'src/lib/fuzzyMatch.ts')).toBeGreaterThan(0);
  });

  it('scores word boundary matches higher', () => {
    // "gp" matching at word boundaries (Git Panel) vs spread
    const boundaryScore = fuzzyMatch('gp', 'git-panel');
    const spreadScore = fuzzyMatch('gp', 'grouping');
    expect(boundaryScore).toBeGreaterThan(spreadScore);
  });

  it('handles camelCase boundaries', () => {
    const score = fuzzyMatch('CP', 'CommandPalette');
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 when query is longer than target', () => {
    expect(fuzzyMatch('abcdefgh', 'abc')).toBe(0);
  });

  it('matches special characters like .ts in file extensions', () => {
    expect(fuzzyMatch('.ts', 'fuzzyMatch.ts')).toBeGreaterThan(0);
    expect(fuzzyMatch('.tsx', 'Component.tsx')).toBeGreaterThan(0);
  });

  it('matches single character queries', () => {
    expect(fuzzyMatch('c', 'CommandPalette')).toBeGreaterThan(0);
    expect(fuzzyMatch('z', 'abc')).toBe(0);
  });
});

describe('fuzzyFilter', () => {
  it('returns 0 for no match', () => {
    expect(fuzzyFilter('hello', 'xyz')).toBe(0);
  });

  it('returns > 0 for match (reversed args vs fuzzyMatch)', () => {
    // fuzzyFilter(value, search) -> fuzzyMatch(search, value)
    expect(fuzzyFilter('CommandPalette', 'cmd')).toBeGreaterThan(0);
  });

  it('returns > 0 for empty search', () => {
    expect(fuzzyFilter('anything', '')).toBeGreaterThan(0);
  });

  it('returns > 0 when keyword matches but value does not', () => {
    expect(fuzzyFilter('Github: View Pull Requests', 'PR', ['PR', 'PRs'])).toBeGreaterThan(0);
  });

  it('returns the max score across value and keywords', () => {
    const valueOnly = fuzzyFilter('Pull Requests', 'PR');
    const withKeywords = fuzzyFilter('Pull Requests', 'PR', ['PR', 'PRs']);
    expect(withKeywords).toBeGreaterThanOrEqual(valueOnly);
  });

  it('works with no keywords (backward compatible)', () => {
    expect(fuzzyFilter('CommandPalette', 'cmd')).toBeGreaterThan(0);
    expect(fuzzyFilter('CommandPalette', 'cmd', undefined)).toBeGreaterThan(0);
    expect(fuzzyFilter('CommandPalette', 'cmd', [])).toBeGreaterThan(0);
  });
});
