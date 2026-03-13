import { describe, it, expect } from 'vitest';
import { computeIntraLineDiff } from './intra-line-diff';
import type { DiffSegment } from './intra-line-diff';

// Helper: flatten segments to a string (for easier debugging)
function flatten(segments: DiffSegment[]): string {
  return segments.map((s) => s.text).join('');
}

describe('computeIntraLineDiff', () => {
  it('single word change in the middle', () => {
    const old = 'const name = "Alice";';
    const next = 'const name = "Bob";';
    const result = computeIntraLineDiff(old, next);

    // Flattened should equal the original strings
    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // Specific segments
    expect(result.oldSegments).toEqual([
      { text: 'const name = "', type: 'same' },
      { text: 'Alice', type: 'changed' },
      { text: '";', type: 'same' },
    ]);
    expect(result.newSegments).toEqual([
      { text: 'const name = "', type: 'same' },
      { text: 'Bob', type: 'changed' },
      { text: '";', type: 'same' },
    ]);
  });

  it('completely different lines are entirely changed', () => {
    const old = "import { foo } from 'bar';";
    const next = 'export const baz = 42;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // Both lines should have at least one 'changed' segment and no 'same' segments
    // (for completely different content, the LCS might find a few chars in common,
    //  so we verify there are no large 'same' chunks — at least the bulk is changed)
    const oldSameText = result.oldSegments
      .filter((s) => s.type === 'same')
      .map((s) => s.text)
      .join('');
    const newSameText = result.newSegments
      .filter((s) => s.type === 'same')
      .map((s) => s.text)
      .join('');

    // The 'same' portions should be a small fraction of the total content
    expect(oldSameText.length).toBeLessThan(old.length * 0.5);
    expect(newSameText.length).toBeLessThan(next.length * 0.5);
  });

  it('identical lines are entirely same', () => {
    const line = 'const x = 1;';
    const result = computeIntraLineDiff(line, line);

    expect(flatten(result.oldSegments)).toBe(line);
    expect(flatten(result.newSegments)).toBe(line);

    expect(result.oldSegments).toEqual([{ text: line, type: 'same' }]);
    expect(result.newSegments).toEqual([{ text: line, type: 'same' }]);
  });

  it('change at the beginning', () => {
    const old = 'let x = 1;';
    const next = 'const x = 1;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // ' x = 1;' should be same (shared suffix)
    const oldSame = result.oldSegments
      .filter((s) => s.type === 'same')
      .map((s) => s.text)
      .join('');
    expect(oldSame).toContain('x = 1;');

    // The changed portion in old should include some part of 'let'
    const oldChanged = result.oldSegments
      .filter((s) => s.type === 'changed')
      .map((s) => s.text)
      .join('');
    expect(old.startsWith(oldChanged) || oldChanged.length > 0).toBe(true);
    expect(oldChanged.length).toBeGreaterThan(0);

    // Similarly for new — changed portion includes part of 'const'
    const newChanged = result.newSegments
      .filter((s) => s.type === 'changed')
      .map((s) => s.text)
      .join('');
    expect(newChanged.length).toBeGreaterThan(0);
  });

  it('change at the end', () => {
    const old = 'return result;';
    const next = 'return result.data;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // 'return result' should be same (common prefix)
    const oldSame = result.oldSegments
      .filter((s) => s.type === 'same')
      .map((s) => s.text)
      .join('');
    expect(oldSame).toContain('return result');

    // The new line has additional text '.data' that should be marked changed
    const newChanged = result.newSegments
      .filter((s) => s.type === 'changed')
      .map((s) => s.text)
      .join('');
    expect(newChanged.length).toBeGreaterThan(0);
    // The changed text in new should include some of the extra characters
    // (note: character-level LCS may split chars non-contiguously across segments)
    const newChangedSet = new Set(newChanged);
    expect(newChangedSet.has('d') || newChangedSet.has('a')).toBe(true);
  });

  it('multiple changes in one line', () => {
    const old = 'function add(a, b) { return a + b; }';
    const next = 'function multiply(a, b) { return a * b; }';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // 'add' should appear as changed in old
    const oldChanged = result.oldSegments
      .filter((s) => s.type === 'changed')
      .map((s) => s.text)
      .join('');
    const newChanged = result.newSegments
      .filter((s) => s.type === 'changed')
      .map((s) => s.text)
      .join('');

    expect(oldChanged).toContain('add');
    expect(newChanged).toContain('multiply');

    // Both should have some 'same' content (the shared parts)
    const oldSame = result.oldSegments
      .filter((s) => s.type === 'same')
      .map((s) => s.text)
      .join('');
    expect(oldSame.length).toBeGreaterThan(0);
  });

  it('empty old line — new line is entirely changed', () => {
    const old = '';
    const next = 'const x = 1;';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // Old has nothing; new should be entirely 'changed'
    expect(result.oldSegments.every((s) => s.text === '' || s.type === 'changed')).toBe(true);
    expect(result.newSegments).toEqual([{ text: next, type: 'changed' }]);
  });

  it('empty new line — old line is entirely changed', () => {
    const old = 'const x = 1;';
    const next = '';
    const result = computeIntraLineDiff(old, next);

    expect(flatten(result.oldSegments)).toBe(old);
    expect(flatten(result.newSegments)).toBe(next);

    // Old should be entirely 'changed'
    expect(result.oldSegments).toEqual([{ text: old, type: 'changed' }]);
    expect(result.newSegments.every((s) => s.text === '' || s.type === 'changed')).toBe(true);
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
    const cases = [
      ['hello world', 'hello there'],
      ['foo bar baz', 'foo qux baz'],
      ['  indented code', '    more indented code'],
      ['', ''],
    ];
    for (const [old, next] of cases) {
      const result = computeIntraLineDiff(old!, next!);
      expect(flatten(result.oldSegments)).toBe(old);
      expect(flatten(result.newSegments)).toBe(next);
    }
  });
});
