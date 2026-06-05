/**
 * JSONC parser — Tests
 */

import { describe, expect, test } from 'vitest';

import { parseJsonc } from './jsonc.js';

describe('parseJsonc', () => {
  test('parses plain JSON unchanged', () => {
    expect(parseJsonc('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });

  test('strips // line comments', () => {
    const input = `{
      // leading comment
      "a": 1, // trailing comment
      "b": 2
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1, b: 2 });
  });

  test('strips /* block */ comments', () => {
    const input = `{
      "a": 1,
      /* multi
         line */
      "b": 2
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1, b: 2 });
  });

  test('removes trailing commas in objects and arrays', () => {
    const input = `{
      "a": [1, 2, 3,],
      "b": { "c": 1, },
    }`;
    expect(parseJsonc(input)).toEqual({ a: [1, 2, 3], b: { c: 1 } });
  });

  test('preserves // inside string values (e.g. URLs)', () => {
    const input = `{ "$schema": "https://turbo.build/schema.json" }`;
    expect(parseJsonc(input)).toEqual({ $schema: 'https://turbo.build/schema.json' });
  });

  test('preserves /* and comma-like content inside strings', () => {
    const input = `{ "a": "/* not a comment */", "b": "x, y, z" }`;
    expect(parseJsonc(input)).toEqual({ a: '/* not a comment */', b: 'x, y, z' });
  });

  test('preserves escaped quotes inside strings', () => {
    const input = `{ "a": "she said \\"hi\\" // ok" }`;
    expect(parseJsonc(input)).toEqual({ a: 'she said "hi" // ok' });
  });

  test('matches the real turbo.json shape with comments', () => {
    const input = `{
      "$schema": "https://turbo.build/schema.json",
      "tasks": {
        "build": { "cache": true },
        // Package-specific tasks REPLACE the global task.
        "test": { "cache": false }
      }
    }`;
    expect(parseJsonc(input)).toEqual({
      $schema: 'https://turbo.build/schema.json',
      tasks: { build: { cache: true }, test: { cache: false } },
    });
  });

  test('throws on genuinely invalid JSON', () => {
    expect(() => parseJsonc('{ "a": }')).toThrow();
  });
});
