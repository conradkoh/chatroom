import { beforeEach, describe, expect, it } from 'vitest';

import {
  fileTreeEntriesToExplorerNodes,
  fileTreeEntriesToFileEntries,
  filterFileTreeEntries,
} from './fileTreeUtils';

import { pendingOptimisticDeletePaths } from '@/modules/chatroom/workspace/hooks/pendingOptimisticDeletePaths';

beforeEach(() => {
  pendingOptimisticDeletePaths.clear();
});

describe('fileTreeEntriesToFileEntries', () => {
  it('maps file tree entries to file entries', () => {
    expect(
      fileTreeEntriesToFileEntries([
        { path: 'src/index.ts', type: 'file', size: 42 },
        { path: 'src', type: 'directory' },
      ])
    ).toEqual([
      { path: 'src/index.ts', type: 'file', size: 42 },
      { path: 'src', type: 'directory' },
    ]);
  });
});

describe('fileTreeEntriesToExplorerNodes', () => {
  it('builds nested hierarchy from flat entries', () => {
    const nodes = fileTreeEntriesToExplorerNodes([
      { path: 'src', type: 'directory' },
      { path: 'src/index.ts', type: 'file' },
      { path: 'README.md', type: 'file' },
    ]);

    expect(nodes).toHaveLength(2);
    const src = nodes.find((n) => n.path === 'src');
    expect(src?.type).toBe('directory');
    expect(src?.children).toEqual([
      expect.objectContaining({ path: 'src/index.ts', type: 'file', name: 'index.ts' }),
    ]);
    expect(nodes.find((n) => n.path === 'README.md')?.name).toBe('README.md');
  });

  it('derives implicit parent directories from file paths', () => {
    const nodes = fileTreeEntriesToExplorerNodes([{ path: 'src/lib/util.ts', type: 'file' }]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.path).toBe('src');
    expect(nodes[0]?.children[0]?.path).toBe('src/lib');
    expect(nodes[0]?.children[0]?.children[0]?.path).toBe('src/lib/util.ts');
  });

  it('excludes paths pending optimistic delete', () => {
    pendingOptimisticDeletePaths.add('src/old.ts');
    const nodes = fileTreeEntriesToExplorerNodes([
      { path: 'src/old.ts', type: 'file' },
      { path: 'src/new.ts', type: 'file' },
    ]);

    const allPaths: string[] = [];
    const walk = (node: { path: string; children: typeof nodes }) => {
      allPaths.push(node.path);
      for (const child of node.children) walk(child);
    };
    for (const node of nodes) walk(node);

    expect(allPaths).not.toContain('src/old.ts');
    expect(allPaths).toContain('src/new.ts');
  });
});

describe('filterFileTreeEntries', () => {
  it('filters by case-insensitive path substring', () => {
    const entries = [
      { path: 'src/App.tsx', type: 'file' as const },
      { path: 'docs/readme.md', type: 'file' as const },
    ];

    expect(filterFileTreeEntries(entries, 'app')).toEqual([{ path: 'src/App.tsx', type: 'file' }]);
    expect(filterFileTreeEntries(entries, '')).toEqual(entries);
  });
});
