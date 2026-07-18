import { describe, expect, it } from 'vitest';

import { flattenVisibleExplorerNodes } from './explorerTreeFlatten';
import type { ExplorerTreeNode } from '../files/explorer-tree';

function makeDir(name: string, children: ExplorerTreeNode[] = []): ExplorerTreeNode {
  return { name, path: name, type: 'directory', children };
}

function makeFile(name: string): ExplorerTreeNode {
  return { name, path: name, type: 'file', children: [] };
}

describe('flattenVisibleExplorerNodes', () => {
  it('flattens files and directories at root level', () => {
    const nodes = [makeFile('a.txt'), makeFile('b.txt')];
    const rows = flattenVisibleExplorerNodes(nodes, new Set());
    expect(rows).toHaveLength(2);
    expect(rows[0].node.name).toBe('a.txt');
    expect(rows[0].depth).toBe(0);
  });

  it('includes children when directory is expanded', () => {
    const nodes = [makeDir('src', [makeFile('index.ts'), makeFile('utils.ts')])];
    const rows = flattenVisibleExplorerNodes(nodes, new Set(['src']));
    expect(rows).toHaveLength(3);
    expect(rows[0].node.name).toBe('src');
    expect(rows[0].depth).toBe(0);
    expect(rows[1].node.name).toBe('index.ts');
    expect(rows[1].depth).toBe(1);
    expect(rows[2].node.name).toBe('utils.ts');
    expect(rows[2].depth).toBe(1);
  });

  it('hides children when directory is collapsed', () => {
    const nodes = [makeDir('src', [makeFile('index.ts')])];
    const rows = flattenVisibleExplorerNodes(nodes, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].node.name).toBe('src');
  });

  it('handles deeply nested directories', () => {
    const cNode = makeDir('c', [makeFile('d.txt')]);
    const bNode = makeDir('b', [cNode]);
    const nodes = [makeDir('a', [bNode])];
    const rows = flattenVisibleExplorerNodes(nodes, new Set(['a', 'b', 'c']));
    expect(rows).toHaveLength(4);
    expect(rows[0].depth).toBe(0);
    expect(rows[1].depth).toBe(1);
    expect(rows[2].depth).toBe(2);
    expect(rows[3].depth).toBe(3);
    expect(rows[3].node.name).toBe('d.txt');
  });
});
