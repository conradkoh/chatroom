import { describe, test, expect } from 'vitest';

import { parseCsv } from './csvParser';

describe('parseCsv', () => {
  test('parses simple CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('handles quoted fields with commas', () => {
    expect(parseCsv('"hello, world",b\n1,2')).toEqual([['hello, world', 'b'], ['1', '2']]);
  });

  test('handles escaped quotes', () => {
    expect(parseCsv('"say ""hello""",b')).toEqual([['say "hello"', 'b']]);
  });

  test('skips empty rows', () => {
    expect(parseCsv('a,b\n\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('handles \\r\\n line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('handles single row without trailing newline', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  test('returns empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
