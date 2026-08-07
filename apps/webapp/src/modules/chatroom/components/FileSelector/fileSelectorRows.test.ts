import { describe, expect, it } from 'vitest';

import { buildFileSelectorRows, scoreFileForSearch } from './fileSelectorRows';
import type { FileEntry } from './useFileSelector';

function makeFile(path: string): FileEntry {
  return { path, type: 'file' };
}

describe('scoreFileForSearch', () => {
  it('returns > 0 for a matching file name', () => {
    expect(scoreFileForSearch('src/components/Button.tsx', 'button')).toBeGreaterThan(0);
  });

  it('returns > 0 for a matching path segment', () => {
    expect(scoreFileForSearch('src/components/Button.tsx', 'components')).toBeGreaterThan(0);
  });

  it('returns 0 for no match', () => {
    expect(scoreFileForSearch('src/components/Button.tsx', 'zzz')).toBe(0);
  });
});

describe('buildFileSelectorRows', () => {
  it('returns files only (no headings) when there are no recents', () => {
    const rows = buildFileSelectorRows([makeFile('a.ts'), makeFile('b.ts')], [], '');
    expect(rows).toEqual([
      { type: 'item', id: 'a.ts', path: 'a.ts', isRecent: false },
      { type: 'item', id: 'b.ts', path: 'b.ts', isRecent: false },
    ]);
  });

  it('emits recent heading + recent items + files heading, excluding recents from files', () => {
    const rows = buildFileSelectorRows(
      [makeFile('recent/a.ts'), makeFile('other/b.ts'), makeFile('other/c.ts')],
      ['recent/a.ts'],
      ''
    );

    expect(rows).toEqual([
      { type: 'heading', id: 'recent', label: 'recently opened' },
      { type: 'item', id: 'recent:recent/a.ts', path: 'recent/a.ts', isRecent: true },
      { type: 'heading', id: 'files', label: 'files' },
      { type: 'item', id: 'other/b.ts', path: 'other/b.ts', isRecent: false },
      { type: 'item', id: 'other/c.ts', path: 'other/c.ts', isRecent: false },
    ]);
  });

  it('does not duplicate a recent path in the files section', () => {
    const rows = buildFileSelectorRows(
      [makeFile('shared.ts'), makeFile('shared.ts')],
      ['shared.ts'],
      ''
    );
    const itemPaths = rows
      .filter((r) => r.type === 'item')
      .map((r) => (r.type === 'item' ? r.path : ''));
    expect(itemPaths.filter((p) => p === 'shared.ts')).toHaveLength(1);
  });

  it('filters and ranks by score in search mode, deduping recents', () => {
    const rows = buildFileSelectorRows(
      [makeFile('alpha.ts'), makeFile('AlphaProject.ts'), makeFile('beta.ts')],
      ['alpha.ts'],
      'alpha'
    );
    const items = rows.filter((r) => r.type === 'item');
    // alpha.ts (exact name match) ranks first as the recent entry; the file
    // version is deduped, and AlphaProject.ts is the next best match.
    expect(items.map((r) => (r.type === 'item' ? r.id : ''))).toEqual([
      'recent:alpha.ts',
      'AlphaProject.ts',
    ]);
    expect(rows.some((r) => r.type === 'heading')).toBe(false);
  });

  it('returns no rows when search matches nothing', () => {
    const rows = buildFileSelectorRows([makeFile('alpha.ts')], ['alpha.ts'], 'zzz');
    expect(rows).toEqual([]);
  });
});
