import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileExplorerPanel } from './FileExplorerPanel';
import {
  __resetWorkspaceFileTreeStoreForTests,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
} from '../files/workspaceFileTreeStore';
import type { UseFileTabsReturn } from '../hooks/useFileTabs';

const treeRefresh = vi.hoisted(() => vi.fn());

const mockCreateFile = vi.hoisted(() => vi.fn());
const mockRequestDelete = vi.hoisted(() => vi.fn());
const mockConfirmDelete = vi.hoisted(() => vi.fn());
const mockRequestRename = vi.hoisted(() => vi.fn());
const mockConfirmRename = vi.hoisted(() => vi.fn());
const mockRequestMkdir = vi.hoisted(() => vi.fn());
const mockConfirmMkdir = vi.hoisted(() => vi.fn());

vi.mock('@/modules/chatroom/workspace/files/useWorkspaceFileTreeEntries', () => ({
  useWorkspaceFileTreeEntries: () => ({
    entries: [],
    isLoading: false,
    hasTree: true,
    refresh: treeRefresh,
  }),
}));

vi.mock('../hooks/useWorkspaceFileCreate', () => ({
  useWorkspaceFileCreate: () => ({
    createFile: mockCreateFile,
    creating: false,
  }),
}));

vi.mock('../hooks/useWorkspaceFileDelete', () => ({
  useWorkspaceFileDelete: () => ({
    requestDelete: mockRequestDelete,
    confirmDelete: mockConfirmDelete,
  }),
}));

vi.mock('../hooks/useOpenFileOnRemote', () => ({
  useOpenFileOnRemote: () => ({
    openFileOnRemote: vi.fn(),
  }),
}));

vi.mock('../hooks/useWorkspaceFileRename', () => ({
  useWorkspaceFileRename: () => ({
    requestRename: mockRequestRename,
    confirmRename: mockConfirmRename,
  }),
}));

vi.mock('../hooks/useWorkspaceFileMkdir', () => ({
  useWorkspaceFileMkdir: () => ({
    requestMkdir: mockRequestMkdir,
    confirmMkdir: mockConfirmMkdir,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => null,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { workspaceFiles: { requestFileContent: {}, getFileContentV2: {} } },
}));

vi.mock('../hooks/useFileContent', () => ({
  useFileContent: vi.fn(() => null),
}));

const WORKSPACE_KEY = toWorkspaceFileTreeKey('machine-1', '/workspace');

const fileTabs = {
  tabs: [],
  activeTabPath: null,
  expandedTabPath: null,
  expandedPane: null,
  openPreview: vi.fn(),
  pinTab: vi.fn(),
  closeTab: vi.fn(),
  closeOtherTabs: vi.fn(),
  setActiveTab: vi.fn(),
  toggleExpanded: vi.fn(),
  togglePreviewExpanded: vi.fn(),
  renamePath: vi.fn(),
  rightTabs: [],
  activeRightTabKey: null,
  openRight: vi.fn(),
  closeRight: vi.fn(),
  setActiveRightTab: vi.fn(),
} satisfies UseFileTabsReturn;

const defaultProps = {
  machineId: 'machine-1',
  workingDir: '/workspace',
  fileTabs,
  activeTabPath: null,
  explorerSyncEnabled: false,
  onToggleSync: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  __resetWorkspaceFileTreeStoreForTests();
  upsertWorkspaceFileTree(
    WORKSPACE_KEY,
    [
      { path: 'src', type: 'directory' },
      { path: 'package.json', type: 'file' },
    ],
    1
  );

  mockCreateFile.mockResolvedValue(undefined);
  mockRequestDelete.mockResolvedValue({ requestId: 'req-delete-1' });
  mockConfirmDelete.mockResolvedValue(undefined);
  mockRequestRename.mockResolvedValue({ requestId: 'req-rename-1' });
  mockConfirmRename.mockResolvedValue(undefined);
  mockRequestMkdir.mockResolvedValue({ requestId: 'req-mkdir-1' });
  mockConfirmMkdir.mockResolvedValue(undefined);
});

describe('FileExplorerPanel create/delete integration', () => {
  it('refreshes the explorer after a new file is created', async () => {
    const onFileCreated = vi.fn();

    render(<FileExplorerPanel {...defaultProps} onFileCreated={onFileCreated} />);

    expect(screen.getByTitle('package.json')).toBeInTheDocument();
    treeRefresh.mockClear();

    fireEvent.click(screen.getByLabelText('New file'));

    const input = await screen.findByPlaceholderText('docs/notes.md');
    fireEvent.change(input, { target: { value: 'notes.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onFileCreated).toHaveBeenCalledWith('notes.md');
    expect(mockCreateFile).toHaveBeenCalledWith('notes.md', '');

    await waitFor(() => {
      expect(treeRefresh).toHaveBeenCalledWith({ force: true });
    });

    expect(screen.getByTitle('package.json')).toBeInTheDocument();
  });

  it('refreshes the explorer after confirming file deletion from the context menu', async () => {
    const onFileDeleted = vi.fn();

    render(<FileExplorerPanel {...defaultProps} onFileDeleted={onFileDeleted} />);

    fireEvent.contextMenu(screen.getByTitle('package.json'));

    const deleteMenuItem = await screen.findByRole('menuitem', { name: /delete/i });
    fireEvent.click(deleteMenuItem);

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/delete file\?/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockRequestDelete).toHaveBeenCalledWith('package.json');
      expect(onFileDeleted).toHaveBeenCalledWith('package.json');
      expect(treeRefresh).toHaveBeenCalledWith({ force: true });
    });

    await waitFor(() => {
      expect(mockConfirmDelete).toHaveBeenCalledWith('req-delete-1');
    });

    expect(screen.getByTitle('package.json')).toBeInTheDocument();
  });

  it('opens New File from empty-area context menu', async () => {
    render(<FileExplorerPanel {...defaultProps} />);

    const scrollArea = screen.getByTitle('package.json').closest('.overflow-y-auto');
    expect(scrollArea).not.toBeNull();
    fireEvent.contextMenu(scrollArea!);

    const newFileItem = await screen.findByRole('menuitem', { name: /new file/i });
    fireEvent.click(newFileItem);

    expect(await screen.findByPlaceholderText('docs/notes.md')).toBeInTheDocument();
  });

  it('renames a file from the context menu', async () => {
    render(<FileExplorerPanel {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('package.json'));

    const renameMenuItem = await screen.findByRole('menuitem', { name: /rename/i });
    fireEvent.click(renameMenuItem);

    const input = await screen.findByLabelText('New file name');
    fireEvent.change(input, { target: { value: 'manifest.json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockRequestRename).toHaveBeenCalledWith('package.json', 'manifest.json');
      expect(fileTabs.renamePath).toHaveBeenCalledWith('package.json', 'manifest.json');
    });
  });

  it('does not enter a refresh loop after create completes', async () => {
    render(<FileExplorerPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle('package.json')).toBeInTheDocument();
    });
    treeRefresh.mockClear();

    fireEvent.click(screen.getByLabelText('New file'));
    const input = await screen.findByPlaceholderText('docs/notes.md');
    fireEvent.change(input, { target: { value: 'docs/new-note.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockCreateFile).toHaveBeenCalledWith('docs/new-note.md', '');
      expect(treeRefresh).toHaveBeenCalledWith({ force: true });
    });

    const callsAfterSettle = treeRefresh.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(treeRefresh.mock.calls.length).toBe(callsAfterSettle);
    expect(screen.getByTitle('package.json')).toBeInTheDocument();
  });

  it('creates a folder from the root context menu', async () => {
    render(<FileExplorerPanel {...defaultProps} />);

    const scrollArea = screen.getByTitle('package.json').closest('.overflow-y-auto');
    expect(scrollArea).not.toBeNull();
    fireEvent.contextMenu(scrollArea!);

    const newFolderItem = await screen.findByRole('menuitem', { name: /new folder/i });
    fireEvent.click(newFolderItem);

    const input = await screen.findByPlaceholderText('docs');
    fireEvent.change(input, { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockRequestMkdir).toHaveBeenCalledWith('docs');
    });

    await waitFor(() => {
      expect(mockConfirmMkdir).toHaveBeenCalledWith('req-mkdir-1');
      expect(treeRefresh).toHaveBeenCalledWith({ force: true });
    });
  });

  it('creates a folder from a directory context menu', async () => {
    render(<FileExplorerPanel {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('src'));

    const newFolderItem = await screen.findByRole('menuitem', { name: /new folder/i });
    fireEvent.click(newFolderItem);

    const input = await screen.findByLabelText('Folder name in src');
    fireEvent.change(input, { target: { value: 'components' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockRequestMkdir).toHaveBeenCalledWith('src/components');
    });
  });
});
