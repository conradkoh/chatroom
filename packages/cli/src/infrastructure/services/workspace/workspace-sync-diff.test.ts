import { describe, expect, it } from 'vitest';

import { diffPathIndexes, formatPathDiffSummary } from './workspace-sync-diff.js';

describe('diffPathIndexes', () => {
  it('treats undefined previous as empty', () => {
    expect(diffPathIndexes(undefined, { 'a.ts': 'file' })).toEqual({
      added: ['a.ts'],
      removed: [],
      typeChanged: [],
    });
  });

  it('detects additions only', () => {
    expect(diffPathIndexes({ 'a.ts': 'file' }, { 'a.ts': 'file', 'b.ts': 'file' })).toEqual({
      added: ['b.ts'],
      removed: [],
      typeChanged: [],
    });
  });

  it('detects removals only', () => {
    expect(diffPathIndexes({ 'a.ts': 'file', 'b.ts': 'file' }, { 'a.ts': 'file' })).toEqual({
      added: [],
      removed: ['b.ts'],
      typeChanged: [],
    });
  });

  it('detects type changes', () => {
    expect(diffPathIndexes({ src: 'file' }, { src: 'directory' })).toEqual({
      added: [],
      removed: [],
      typeChanged: ['src'],
    });
  });

  it('returns no-op diff when indexes match', () => {
    const paths = { 'a.ts': 'file' as const, src: 'directory' as const };
    expect(diffPathIndexes(paths, { ...paths })).toEqual({
      added: [],
      removed: [],
      typeChanged: [],
    });
  });
});

describe('formatPathDiffSummary', () => {
  it('formats added and removed counts', () => {
    expect(
      formatPathDiffSummary({ added: ['a.ts', 'b.ts'], removed: ['c.ts'], typeChanged: [] })
    ).toBe('+2 added, -1 removed');
  });

  it('includes type-changed count when present', () => {
    expect(formatPathDiffSummary({ added: [], removed: [], typeChanged: ['src'] })).toBe(
      '+0 added, -0 removed, ~1 type-changed'
    );
  });
});
