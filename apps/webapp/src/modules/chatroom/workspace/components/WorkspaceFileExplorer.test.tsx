import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { WorkspaceFileExplorer } from './WorkspaceFileExplorer';

const mockRootNodes = [
  { name: 'src', path: 'src', type: 'directory' as const, children: [] },
  {
    name: 'index.ts',
    path: 'src/index.ts',
    type: 'file' as const,
    children: [],
  },
  { name: 'package.json', path: 'package.json', type: 'file' as const, children: [] },
];

const loadChildren = vi.fn();
const refresh = vi.fn();
const handleDirUpdate = vi.fn();

vi.mock('@/modules/chatroom/workspace/files', () => ({
  useWorkspaceDirExplorer: () => ({
    rootNodes: mockRootNodes,
    childMap: new Map(),
    loadingDirs: new Set(),
    requestedDirs: [],
    loadChildren,
    isLoading: false,
    refresh,
    isSearchMode: false,
    refreshToken: 0,
    handleDirUpdate,
  }),
  DirListingWatcher: () => null,
}));

vi.mock('@/modules/chatroom/workspace/files/useDirListingWatch', () => ({
  useDirListingWatch: vi.fn(),
}));

beforeEach(() => {
  loadChildren.mockClear();
});

describe('WorkspaceFileExplorer', () => {
  const defaultProps = {
    machineId: 'test-machine',
    workingDir: '/test',
  };

  it('applies highlight class when selectedPath matches a node', () => {
    render(
      <WorkspaceFileExplorer
        {...defaultProps}
        selectedPath="src/index.ts"
        revealPath="src/index.ts"
      />
    );

    const selectedButton = screen.getByTitle('src/index.ts');
    expect(selectedButton.className).toContain('bg-chatroom-accent/10');
  });

  it('does not apply highlight class when selectedPath is null', () => {
    render(
      <WorkspaceFileExplorer {...defaultProps} selectedPath={null} revealPath="src/index.ts" />
    );

    const button = screen.getByTitle('src/index.ts');
    expect(button.className).not.toContain('bg-chatroom-accent/10');
  });

  it('renders tree nodes without per-node ContextMenu', () => {
    render(<WorkspaceFileExplorer {...defaultProps} selectedPath={null} />);

    expect(screen.getByTitle('package.json')).toHaveAttribute('data-tree-node');
    expect(document.querySelectorAll('[data-slot="context-menu"]')).toHaveLength(0);
  });

  it('forwards node context menu events to parent', () => {
    const onNodeContextMenu = vi.fn();

    render(
      <WorkspaceFileExplorer
        {...defaultProps}
        selectedPath={null}
        onNodeContextMenu={onNodeContextMenu}
      />
    );

    fireEvent.contextMenu(screen.getByTitle('src/index.ts'));

    expect(onNodeContextMenu).toHaveBeenCalledTimes(1);
    expect(onNodeContextMenu.mock.calls[0]?.[0]).toMatchObject({
      path: 'src/index.ts',
      type: 'file',
    });
  });

  it('renders file nodes from dir explorer hook', () => {
    render(<WorkspaceFileExplorer {...defaultProps} selectedPath={null} />);
    expect(screen.getByTitle('package.json')).toBeInTheDocument();
  });

  it('does not call loadChildren again when revealPath changes within the same parent directory', () => {
    const { rerender } = render(
      <WorkspaceFileExplorer {...defaultProps} selectedPath={null} revealPath="src/a.ts" />
    );

    expect(loadChildren).toHaveBeenCalledTimes(1);
    expect(loadChildren).toHaveBeenCalledWith('src');

    rerender(<WorkspaceFileExplorer {...defaultProps} selectedPath={null} revealPath="src/b.ts" />);

    expect(loadChildren).toHaveBeenCalledTimes(1);
  });
});
