import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

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

  it('accepts onNewFileInDir and onDeleteFile callbacks without crashing', () => {
    const onNewFileInDir = vi.fn();
    const onDeleteFile = vi.fn();

    render(
      <WorkspaceFileExplorer
        {...defaultProps}
        selectedPath={null}
        onNewFileInDir={onNewFileInDir}
        onDeleteFile={onDeleteFile}
      />
    );

    expect(screen.getByTitle('src/index.ts')).toBeInTheDocument();
  });

  it('renders file nodes from dir explorer hook', () => {
    render(<WorkspaceFileExplorer {...defaultProps} selectedPath={null} />);
    expect(screen.getByTitle('package.json')).toBeInTheDocument();
  });
});
