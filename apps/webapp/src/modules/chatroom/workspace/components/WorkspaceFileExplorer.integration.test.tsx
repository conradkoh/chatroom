import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceFileExplorer } from './WorkspaceFileExplorer';
import {
  __resetWorkspaceFileTreeStoreForTests,
  getWorkspaceFileTreeEntries,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
} from '../files/workspaceFileTreeStore';

const treeRefresh = vi.hoisted(() => vi.fn());

vi.mock('@/modules/chatroom/workspace/files/useWorkspaceFileTreeEntries', () => ({
  useWorkspaceFileTreeEntries: ({
    machineId,
    workingDir,
  }: {
    machineId: string;
    workingDir: string;
  }) => {
    const treeEntries = getWorkspaceFileTreeEntries(toWorkspaceFileTreeKey(machineId, workingDir));
    return {
      entries: [],
      treeEntries,
      isLoading: false,
      hasTree: treeEntries.length > 0,
      refresh: treeRefresh,
    };
  },
}));

const WORKSPACE_KEY = toWorkspaceFileTreeKey('machine-1', '/workspace');

const defaultProps = {
  machineId: 'machine-1',
  workingDir: '/workspace',
  selectedPath: null as string | null,
};

beforeEach(() => {
  localStorage.clear();
  treeRefresh.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  __resetWorkspaceFileTreeStoreForTests();
  upsertWorkspaceFileTree(
    WORKSPACE_KEY,
    [
      { path: 'src', type: 'directory' },
      { path: 'src/index.ts', type: 'file' },
      { path: 'package.json', type: 'file' },
    ],
    1
  );
});

describe('WorkspaceFileExplorer integration', () => {
  it('renders root listings and expands a folder without an update loop', async () => {
    render(<WorkspaceFileExplorer {...defaultProps} />);

    expect(screen.getByTitle('package.json')).toBeInTheDocument();
    expect(screen.queryByTitle('src/index.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('src'));

    await waitFor(
      () => {
        expect(screen.getByTitle('src/index.ts')).toBeInTheDocument();
      },
      { timeout: 1000 }
    );
  });

  it('auto-expands revealPath without hanging', async () => {
    render(
      <WorkspaceFileExplorer
        {...defaultProps}
        revealPath="src/index.ts"
        selectedPath="src/index.ts"
      />
    );

    await waitFor(
      () => {
        expect(screen.getByTitle('src/index.ts')).toBeInTheDocument();
      },
      { timeout: 1000 }
    );
  });
});
