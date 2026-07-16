import { describe, expect, it } from 'vitest';

import {
  collectExpandedDirsForFilter,
  filterExplorerTreeNodes,
  type ExplorerTreeNode,
} from './explorerTreeFilter';

const sampleTree: ExplorerTreeNode[] = [
  {
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      { name: 'index.ts', path: 'src/index.ts', type: 'file', children: [] },
      { name: 'helpers.ts', path: 'src/helpers.ts', type: 'file', children: [] },
    ],
  },
  { name: 'package.json', path: 'package.json', type: 'file', children: [] },
];

describe('filterExplorerTreeNodes', () => {
  it('returns all nodes when query is empty', () => {
    expect(filterExplorerTreeNodes(sampleTree, '')).toEqual(sampleTree);
    expect(filterExplorerTreeNodes(sampleTree, '   ')).toEqual(sampleTree);
  });

  it('filters files by name and keeps parent directories', () => {
    const result = filterExplorerTreeNodes(sampleTree, 'index');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('src');
    expect(result[0]?.children).toHaveLength(1);
    expect(result[0]?.children[0]?.path).toBe('src/index.ts');
  });

  it('matches dotfiles by path segments such as drone.yml', () => {
    const tree: ExplorerTreeNode[] = [
      { name: '.drone.yml', path: '.drone.yml', type: 'file', children: [] },
    ];
    const result = filterExplorerTreeNodes(tree, 'drone.yml');
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('.drone.yml');
  });

  it('is case-insensitive', () => {
    const result = filterExplorerTreeNodes(sampleTree, 'PACKAGE');
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('package.json');
  });
});

describe('collectExpandedDirsForFilter', () => {
  it('collects all directory paths', () => {
    const dirs = collectExpandedDirsForFilter(sampleTree);
    expect(dirs.has('src')).toBe(true);
    expect(dirs.has('package.json')).toBe(false);
  });
});
