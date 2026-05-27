import { describe, it, expect } from 'vitest';

import { computeIntraLineDiff, tokenize } from './intra-line-diff';
import type { DiffSegment } from './intra-line-diff';

// Helper: flatten segments to a string (for easier debugging)
function flatten(segments: DiffSegment[]): string {
  return segments.map((s) => s.text).join('');
}

// Helper: get all text of a given type from segments
function textOfType(segments: DiffSegment[], type: 'same' | 'changed'): string {
  return segments
    .filter((s) => s.type === type)
    .map((s) => s.text)
    .join('');
}

// ─── tokenize ────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('splits words, whitespace, and punctuation', () => {
    expect(tokenize('sha: string;')).toEqual(['sha', ':', ' ', 'string', ';']);
  });

  it('handles camelCase as one token', () => {
    expect(tokenize('fullSha')).toEqual(['fullSha']);
  });

  it('handles leading spaces as whitespace token', () => {
    expect(tokenize('  return x;')).toEqual(['  ', 'return', ' ', 'x', ';']);
  });

  it('handles empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles string with only punctuation', () => {
    expect(tokenize('{ }')).toEqual(['{', ' ', '}']);
  });
});

// ─── computeIntraLineDiff ────────────────────────────────────────────────────

describe('computeIntraLineDiff', () => {
  it('single word change in the middle', () => {
    const old = 'const name = "Alice";';
    const next = 'const name = "Bob";';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // Alice should be entirely in a changed segment, Bob too
    const oldChanged = textOfType(result.oldSegments, 'changed');
    const newChanged = textOfType(result.newSegments, 'changed');

    expect(oldChanged).toContain('Alice');
    expect(newChanged).toContain('Bob');

    // Surrounding text should be same
    const oldSame = textOfType(result.oldSegments, 'same');
    expect(oldSame).toContain('const');
    expect(oldSame).toContain('name');
  });

  it('completely different lines are mostly changed', () => {
    const old = "import { foo } from 'bar';";
    const next = 'export const baz = 42;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // The 'same' portions should be a small fraction of the total content
    const oldSame = textOfType(result.oldSegments, 'same');
    const newSame = textOfType(result.newSegments, 'same');

    expect(oldSame.length).toBeLessThan(old.length * 0.5);
    expect(newSame.length).toBeLessThan(next.length * 0.5);
  });

  it('identical lines are entirely same', () => {
    const line = 'const x = 1;';
    const result = computeIntraLineDiff(line, line);

    expect(flatten(result.oldSegments)).toBe(line);
    expect(flatten(result.newSegments)).toBe(line);

    expect(result.oldSegments).toEqual([{ text: line, type: 'same' }]);
    expect(result.newSegments).toEqual([{ text: line, type: 'same' }]);
  });

  it('change at the beginning — let → const', () => {
    const old = 'let x = 1;';
    const next = 'const x = 1;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // Token-level: 'let' is a single token, should be entirely in changed
    const oldChanged = textOfType(result.oldSegments, 'changed');
    const newChanged = textOfType(result.newSegments, 'changed');

    expect(oldChanged).toContain('let');
    expect(newChanged).toContain('const');

    // The shared ' x = 1;' part should be same
    const oldSame = textOfType(result.oldSegments, 'same');
    expect(oldSame).toContain('x');
    expect(oldSame).toContain('=');
  });

  it('change at the end — result → result.data', () => {
    const old = 'return result;';
    const next = 'return result.data;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // 'return' and 'result' tokens are same
    const oldSame = textOfType(result.oldSegments, 'same');
    expect(oldSame).toContain('return');
    expect(oldSame).toContain('result');

    // The new line has extra tokens (.data) that are changed
    const newChanged = textOfType(result.newSegments, 'changed');
    expect(newChanged.length).toBeGreaterThan(0);
    expect(newChanged).toContain('data');
  });

  it('multiple changes in one line — add→multiply, +→*', () => {
    const old = 'function add(a, b) { return a + b; }';
    const next = 'function multiply(a, b) { return a * b; }';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // Token-level: 'add' and 'multiply' are single tokens → entirely changed
    const oldChanged = textOfType(result.oldSegments, 'changed');
    const newChanged = textOfType(result.newSegments, 'changed');

    expect(oldChanged).toContain('add');
    expect(newChanged).toContain('multiply');

    // '+' and '*' are single punctuation tokens → changed
    expect(oldChanged).toContain('+');
    expect(newChanged).toContain('*');

    // Shared parts like 'function', 'a', 'b' are same
    const oldSame = textOfType(result.oldSegments, 'same');
    expect(oldSame).toContain('function');
  });

  it('empty old line — new line is entirely changed', () => {
    const old = '';
    const next = 'const x = 1;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    expect(result.newSegments).toEqual([{ text: next, type: 'changed' }]);
  });

  it('empty new line — old line is entirely changed', () => {
    const old = 'const x = 1;';
    const next = '';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    expect(result.oldSegments).toEqual([{ text: old, type: 'changed' }]);
  });

  it('no adjacent segments of the same type (segments are merged)', () => {
    const old = 'let count = 0;';
    const next = 'const count = 0;';
    const result = computeIntraLineDiff(old, next);

    // No two consecutive segments should have the same type
    for (const segments of [result.oldSegments, result.newSegments]) {
      for (let i = 1; i < segments.length; i++) {
        expect(segments[i]!.type).not.toBe(segments[i - 1]!.type);
      }
    }
  });

  it('segment texts concatenated equal original strings', () => {
    const cases: [string, string][] = [
      ['hello world', 'hello there'],
      ['foo bar baz', 'foo qux baz'],
      ['  indented code', '    more indented code'],
      ['', ''],
      ['const x = 1;', 'let x = 2;'],
    ];
    for (const [old, next] of cases) {
      const result = computeIntraLineDiff(old, next);
      expect(flatten(result.oldSegments)).toBe(old);
      expect(flatten(result.newSegments)).toBe(next);
    }
  });

  it('token-level: sha → fullSha', () => {
    const old = '  sha: string;';
    const next = '  fullSha: string;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // 'sha' and 'fullSha' are different tokens — should be changed
    const oldChanged = textOfType(result.oldSegments, 'changed');
    const newChanged = textOfType(result.newSegments, 'changed');

    expect(oldChanged).toContain('sha');
    expect(newChanged).toContain('fullSha');

    // ':' and 'string' and ';' should be same
    const oldSame = textOfType(result.oldSegments, 'same');
    expect(oldSame).toContain('string');
  });

  it('token-level: message → commitMessage', () => {
    const old = '  message: string;';
    const next = '  commitMessage: string;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    const oldChanged = textOfType(result.oldSegments, 'changed');
    const newChanged = textOfType(result.newSegments, 'changed');

    expect(oldChanged).toContain('message');
    expect(newChanged).toContain('commitMessage');
  });
});

// ─── trimWhitespaceFromChangedSegments (via computeIntraLineDiff) ─────────────

describe('whitespace trimming in changed segments', () => {
  it('does not include trailing whitespace in a changed segment when next word is unchanged', () => {
    // "foo entry" → "EXIT entry": 'foo ' should not be highlighted; only 'foo' is changed
    const old = 'foo entry';
    const next = 'EXIT entry';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // The space between "foo"/"EXIT" and "entry" should NOT be in a changed segment
    for (const seg of [...result.oldSegments, ...result.newSegments]) {
      if (seg.type === 'changed') {
        expect(seg.text).not.toMatch(/^\s|\s$/);
      }
    }
  });

  it('does not include leading whitespace in a changed segment when prev content is unchanged', () => {
    // "a b entry" → "a b EXIT": ' entry'/'  EXIT' shouldn't have leading space in changed
    const old = 'a b entry';
    const next = 'a b EXIT';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    for (const seg of [...result.oldSegments, ...result.newSegments]) {
      if (seg.type === 'changed') {
        expect(seg.text).not.toMatch(/^\s|\s$/);
      }
    }
  });

  it('preserves full text content after whitespace trimming', () => {
    const cases: [string, string][] = [
      ['foo entry bar', 'EXIT entry bar'],
      ['a b c', 'a B c'],
      ['  indented old', '  indented new'],
      ['foo bar', 'baz bar'],
    ];
    for (const [old, next] of cases) {
      const result = computeIntraLineDiff(old, next);
      expect(flatten(result.oldSegments)).toBe(old);
      expect(flatten(result.newSegments)).toBe(next);
    }
  });

  it('no adjacent same-type segments after whitespace trimming', () => {
    const cases: [string, string][] = [
      ['foo entry', 'EXIT entry'],
      ['a b', 'c b'],
      ['word entry rest', 'other entry rest'],
    ];
    for (const [old, next] of cases) {
      const result = computeIntraLineDiff(old, next);
      for (const segments of [result.oldSegments, result.newSegments]) {
        for (let i = 1; i < segments.length; i++) {
          expect(segments[i]!.type).not.toBe(segments[i - 1]!.type);
        }
      }
    }
  });
});
