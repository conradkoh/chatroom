import { describe, expect, it } from 'vitest';

import { getExplorerRootDropTarget, readExplorerDropTargetFromElement } from './explorerDropTarget';

describe('explorerDropTarget', () => {
  it('uses folder path as target for directory rows', () => {
    const row = document.createElement('button');
    row.setAttribute('data-tree-node', '');
    row.setAttribute('data-path', 'docs');
    row.setAttribute('data-node-type', 'directory');

    expect(readExplorerDropTargetFromElement(row)).toEqual({
      targetDir: 'docs',
      highlightPath: 'docs',
    });
  });

  it('uses parent directory for file rows', () => {
    const row = document.createElement('button');
    row.setAttribute('data-tree-node', '');
    row.setAttribute('data-path', 'docs/spec.pdf');
    row.setAttribute('data-node-type', 'file');

    expect(readExplorerDropTargetFromElement(row)).toEqual({
      targetDir: 'docs',
      highlightPath: 'docs',
    });
  });

  it('uses workspace root for root-level files', () => {
    const row = document.createElement('button');
    row.setAttribute('data-tree-node', '');
    row.setAttribute('data-path', 'README.md');
    row.setAttribute('data-node-type', 'file');

    expect(readExplorerDropTargetFromElement(row)).toEqual({
      targetDir: '',
      highlightPath: '',
    });
  });

  it('defaults to workspace root when not over a row', () => {
    expect(getExplorerRootDropTarget()).toEqual({
      targetDir: '',
      highlightPath: '',
    });
    expect(readExplorerDropTargetFromElement(null)).toBeNull();
  });
});
