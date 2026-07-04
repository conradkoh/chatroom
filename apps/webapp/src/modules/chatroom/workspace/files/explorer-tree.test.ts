import { describe, expect, it } from 'vitest';

import {
  isExplorerSearchMode,
  isFileSearchQueryActive,
  searchEntriesToNodes,
  sortExplorerNodes,
  type ExplorerTreeNode,
} from './explorer-tree';

describe('isExplorerSearchMode', () => {
  it('returns false for empty or single-char queries', () => {
    expect(isExplorerSearchMode('')).toBe(false);
    expect(isExplorerSearchMode('a')).toBe(false);
  });

  it('returns true when query meets minimum length', () => {
    expect(isExplorerSearchMode('ab')).toBe(true);
    expect(isExplorerSearchMode('  ab  ')).toBe(true);
  });
});

describe('isFileSearchQueryActive', () => {
  it('accepts empty query for Cmd+P listing', () => {
    expect(isFileSearchQueryActive('')).toBe(true);
  });

  it('rejects single-char queries', () => {
    expect(isFileSearchQueryActive('a')).toBe(false);
  });

  it('accepts queries at or above minimum length', () => {
    expect(isFileSearchQueryActive('ab')).toBe(true);
  });
});

describe('sortExplorerNodes', () => {
  it('puts directories before files', () => {
    const nodes: ExplorerTreeNode[] = [
      { name: 'index.ts', path: 'index.ts', type: 'file', children: [] },
      { name: 'src', path: 'src', type: 'directory', children: [] },
    ];
    expect(sortExplorerNodes(nodes).map((n) => n.name)).toEqual(['src', 'index.ts']);
  });
});

describe('searchEntriesToNodes', () => {
  it('builds nested paths from flat file entries', () => {
    const nodes = searchEntriesToNodes([
      { path: 'src/auth/login.ts', type: 'file' },
      { path: 'src/index.ts', type: 'file' },
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe('src');
    expect(nodes[0]?.children.map((c) => c.name)).toEqual(['auth', 'index.ts']);
    const auth = nodes[0]?.children.find((c) => c.name === 'auth');
    expect(auth?.children[0]?.path).toBe('src/auth/login.ts');
  });
});
