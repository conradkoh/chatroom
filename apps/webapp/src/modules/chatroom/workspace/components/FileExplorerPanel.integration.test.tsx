import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '@workspace/backend/convex/_generated/api';
import type { WorkspaceGitState } from '@workspace/backend/src/domain/types/workspace-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileExplorerPanel } from './FileExplorerPanel';
import { __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests } from '../files/workspaceFileTreeDeltaSyncCoordinator';
import { __resetWorkspaceFileTreeRefreshCoordinatorForTests } from '../files/workspaceFileTreeRefreshCoordinator';
import {
  __resetWorkspaceFileTreeWatchCoordinatorForTests,
  acquireFileTreeWatch,
} from '../files/workspaceFileTreeWatchCoordinator';
import { useFileContent } from '../hooks/useFileContent';
import type { UseFileTabsReturn } from '../hooks/useFileTabs';
import {
  __resetWorkspaceFileTreeStoreForTests,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
} from '../stores/workspaceFileTreeStore';

// Mock @tanstack/react-virtual so VirtualizedScrollList renders all items in jsdom
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
    getItemKey,
  }: {
    count: number;
    estimateSize: (i: number) => number;
    getItemKey: (i: number) => string;
  }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: getItemKey(index),
        index,
        size: estimateSize(index),
        start: index * estimateSize(index),
        end: (index + 1) * estimateSize(index),
        lane: 0,
      })),
    getTotalSize: () => count * 28,
    scrollToIndex: vi.fn(),
  }),
}));

const mockCreateFile = vi.hoisted(() => vi.fn());
const mockRequestDelete = vi.hoisted(() => vi.fn());
const mockConfirmDelete = vi.hoisted(() => vi.fn());
const mockRequestRename = vi.hoisted(() => vi.fn());
const mockConfirmRename = vi.hoisted(() => vi.fn());
const mockRequestMkdir = vi.hoisted(() => vi.fn());
const mockConfirmMkdir = vi.hoisted(() => vi.fn());
const mockRequestFileTree = vi.hoisted(() => vi.fn());
const idleMutation = vi.hoisted(() => vi.fn());
const mockRequestGitRefresh = vi.hoisted(() => vi.fn());
const mockGitState = vi.hoisted(() => ({ value: { status: 'loading' } as WorkspaceGitState }));
const mockOpenExternalUrl = vi.hoisted(() => vi.fn());

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

vi.mock('./UploadFileDialog', () => ({
  UploadFileDialog: () => null,
}));

vi.mock('./WorkspaceUploadProgressList', () => ({
  WorkspaceUploadProgressList: () => null,
}));

vi.mock('../hooks/useWorkspaceUploadJobs', () => ({
  useWorkspaceUploadJobs: () => ({
    jobs: [],
    startUpload: vi.fn(),
  }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  // Stable identities: a new function per render would re-run the real tree-sync effects.
  // Reference `api` only inside the returned function, not at factory time.
  useSessionMutation: (ref: unknown) => {
    if (ref === api.workspaceFiles.requestFileTree) return mockRequestFileTree;
    if (ref === api.machines.requestGitRefresh) return mockRequestGitRefresh;
    return idleMutation;
  },
  useSessionQuery: (ref: unknown) =>
    ref === api.workspaces.getWorkspaceGitState ? mockGitState.value : null,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      requestFileContent: {},
      getFileContentV2: {},
      requestFileTree: {},
    },
    workspaces: { getWorkspaceGitState: {} },
    machines: { requestGitRefresh: {} },
  },
}));

vi.mock('@/lib/navigation', () => ({
  openExternalUrl: mockOpenExternalUrl,
}));

vi.mock('../hooks/useFileContent', () => ({
  useFileContent: vi.fn(() => null),
}));

const WORKSPACE_KEY = toWorkspaceFileTreeKey('machine-1', '/workspace');

const fileTabs = {
  tabs: [],
  activeTabPath: null,
  activeTabKey: null,
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
  openAgenticQueryTab: vi.fn(),
  closeAgenticQueryTab: vi.fn(),
  rightTabs: [],
  activeRightTabKey: null,
  openRight: vi.fn(),
  closeRight: vi.fn(),
  setActiveRightTab: vi.fn(),
  navigateActivePreview: vi.fn(),
  editorSplit: null,
  moveTabToSecondaryPane: vi.fn(),
  moveTabToPrimaryPane: vi.fn(),
  setActiveSecondaryTab: vi.fn(),
  closeSecondarySplit: vi.fn(),
  handleEditorSplitDrop: vi.fn(),
  editorSplitLayoutEpoch: 0,
} satisfies UseFileTabsReturn;

const defaultProps = {
  machineId: 'machine-1',
  workingDir: '/workspace',
  fileTabs,
  activeTabPath: null,
  fileTreeSyncEnabled: true,
  explorerSyncEnabled: false,
  onToggleSync: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom has no layout, so the drop hook's hit-testing needs an explicit stub.
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(null),
  });
  __resetWorkspaceFileTreeStoreForTests();
  // Tree-sync state is module-level; reset it so each test's first attempt is actually sent.
  __resetWorkspaceFileTreeRefreshCoordinatorForTests();
  __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests();
  __resetWorkspaceFileTreeWatchCoordinatorForTests();
  acquireFileTreeWatch('machine-1', '/workspace', vi.fn());
  upsertWorkspaceFileTree(
    WORKSPACE_KEY,
    [
      { path: 'src', type: 'directory' },
      { path: 'package.json', type: 'file' },
    ],
    1
  );

  mockRequestFileTree.mockReset().mockResolvedValue(undefined);
  idleMutation.mockReset().mockResolvedValue(undefined);
  mockCreateFile.mockResolvedValue(undefined);
  mockRequestDelete.mockResolvedValue({ requestId: 'req-delete-1' });
  mockConfirmDelete.mockResolvedValue(undefined);
  mockRequestRename.mockResolvedValue({ requestId: 'req-rename-1' });
  mockConfirmRename.mockResolvedValue(undefined);
  mockRequestMkdir.mockResolvedValue({ requestId: 'req-mkdir-1' });
  mockConfirmMkdir.mockResolvedValue(undefined);
  mockGitState.value = { status: 'loading' };
  mockRequestGitRefresh.mockReset().mockResolvedValue(undefined);
  mockOpenExternalUrl.mockReset();
});

afterEach(() => {
  __resetWorkspaceFileTreeWatchCoordinatorForTests();
  __resetWorkspaceFileTreeRefreshCoordinatorForTests();
  __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests();
  vi.mocked(useFileContent).mockReturnValue(null);
});

async function submitNewFile(path: string) {
  fireEvent.click(screen.getByLabelText('New file'));
  const input = await screen.findByPlaceholderText('docs/notes.md');
  fireEvent.change(input, { target: { value: path } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('FileExplorerPanel create/delete integration', () => {
  it('refreshes the explorer after a new file is created', async () => {
    const onFileCreated = vi.fn();

    render(<FileExplorerPanel {...defaultProps} onFileCreated={onFileCreated} />);

    expect(screen.getByTitle('package.json')).toBeInTheDocument();
    mockRequestFileTree.mockClear();

    fireEvent.click(screen.getByLabelText('New file'));

    const input = await screen.findByPlaceholderText('docs/notes.md');
    fireEvent.change(input, { target: { value: 'notes.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onFileCreated).toHaveBeenCalledWith('notes.md');
    expect(mockCreateFile).toHaveBeenCalledWith('notes.md', '');

    await waitFor(() => {
      expect(mockRequestFileTree).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/workspace',
        force: true,
      });
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
      expect(mockRequestFileTree).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/workspace',
        force: true,
      });
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
    mockRequestFileTree.mockClear();

    fireEvent.click(screen.getByLabelText('New file'));
    const input = await screen.findByPlaceholderText('docs/notes.md');
    fireEvent.change(input, { target: { value: 'docs/new-note.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockCreateFile).toHaveBeenCalledWith('docs/new-note.md', '');
      expect(mockRequestFileTree).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/workspace',
        force: true,
      });
    });

    const callsAfterSettle = mockRequestFileTree.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockRequestFileTree.mock.calls.length).toBe(callsAfterSettle);
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
      expect(mockRequestFileTree).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/workspace',
        force: true,
      });
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

  it('shows a create failure in the explorer feedback slot', async () => {
    mockCreateFile.mockRejectedValueOnce(new Error('Disk full'));

    render(<FileExplorerPanel {...defaultProps} />);
    await submitNewFile('notes.md');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to create notes.md: Disk full');
    expect(screen.getByTestId('explorer-feedback')).toContainElement(alert);
  });

  it('dismisses the explorer feedback slot', async () => {
    mockCreateFile.mockRejectedValueOnce(new Error('Disk full'));

    render(<FileExplorerPanel {...defaultProps} />);
    await submitNewFile('notes.md');
    expect(await screen.findByTestId('explorer-feedback')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('explorer-feedback')).toBeNull();
  });

  it('shows a delete failure in the explorer feedback slot', async () => {
    mockConfirmDelete.mockRejectedValueOnce(new Error('Permission denied'));

    render(<FileExplorerPanel {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('package.json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    const alert = await screen.findByTestId('explorer-feedback');
    expect(alert).toHaveTextContent('Failed to delete package.json: Permission denied');
    expect(alert).toHaveAttribute('role', 'alert');
  });

  it('shows a rename failure in the explorer feedback slot', async () => {
    mockConfirmRename.mockRejectedValueOnce(new Error('Name taken'));

    render(<FileExplorerPanel {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('package.json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /rename/i }));
    const input = await screen.findByLabelText('New file name');
    fireEvent.change(input, { target: { value: 'manifest.json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByTestId('explorer-feedback');
    expect(alert).toHaveTextContent('Failed to rename package.json: Name taken');
  });

  it('shows a new-folder failure in the explorer feedback slot', async () => {
    mockConfirmMkdir.mockRejectedValueOnce(new Error('Folder already exists'));

    render(<FileExplorerPanel {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('src'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /new folder/i }));
    const input = await screen.findByLabelText('Folder name in src');
    fireEvent.change(input, { target: { value: 'components' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByTestId('explorer-feedback');
    expect(alert).toHaveTextContent('Folder already exists');
  });

  it('shows a blocked drop reason in the explorer feedback slot', async () => {
    render(<FileExplorerPanel {...defaultProps} />);

    fireEvent.drop(screen.getByTitle('package.json'), {
      dataTransfer: {
        types: ['Files'],
        files: [new File(['x'], '.env', { type: 'text/plain' })],
      },
    });

    const alert = await screen.findByTestId('explorer-feedback');
    expect(alert).toHaveTextContent(
      'Cannot upload to this location (.git and sensitive paths are blocked)'
    );
  });

  it('shows no feedback after a successful create', async () => {
    render(<FileExplorerPanel {...defaultProps} />);

    await submitNewFile('notes.md');

    await waitFor(() => {
      expect(mockCreateFile).toHaveBeenCalledWith('notes.md', '');
      expect(mockRequestFileTree).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/workspace',
        force: true,
      });
    });
    expect(screen.queryByTestId('explorer-feedback')).toBeNull();
  });

  it('clears a previous failure when the New file dialog is reopened', async () => {
    mockCreateFile.mockRejectedValueOnce(new Error('Disk full'));

    render(<FileExplorerPanel {...defaultProps} />);
    await submitNewFile('notes.md');
    expect(await screen.findByTestId('explorer-feedback')).toHaveTextContent(
      'Failed to create notes.md: Disk full'
    );

    fireEvent.click(screen.getByLabelText('New file'));

    expect(screen.queryByTestId('explorer-feedback')).toBeNull();
  });
});

describe('FileExplorerPanel tree sync feedback', () => {
  it('shows a tree-sync failure in the explorer feedback slot', async () => {
    mockRequestFileTree.mockImplementation(() =>
      Promise.reject(new Error('Authentication required'))
    );

    render(<FileExplorerPanel {...defaultProps} />);

    const slot = await screen.findByTestId('explorer-feedback');
    expect(slot).toHaveTextContent('Authentication required');
    expect(slot).toHaveAttribute('role', 'alert');
  });

  it('dismisses a tree-sync failure', async () => {
    mockRequestFileTree.mockImplementation(() =>
      Promise.reject(new Error('Authentication required'))
    );

    render(<FileExplorerPanel {...defaultProps} />);
    expect(await screen.findByTestId('explorer-feedback')).toHaveTextContent(
      'Authentication required'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('explorer-feedback')).toBeNull();
  });

  it('clears a tree-sync failure on the next attempt', async () => {
    mockRequestFileTree.mockImplementation(() =>
      Promise.reject(new Error('Authentication required'))
    );

    render(<FileExplorerPanel {...defaultProps} />);
    await screen.findByTestId('explorer-feedback');

    mockRequestFileTree.mockImplementation(() => Promise.resolve());
    fireEvent.click(screen.getByLabelText('Refresh files'));

    await waitFor(() => expect(screen.queryByTestId('explorer-feedback')).toBeNull());
  });
});

describe('FileExplorerPanel file-op feedback survival', () => {
  it('keeps a rename failure visible after the explorer refresh', async () => {
    mockConfirmRename.mockRejectedValueOnce(new Error('Name taken'));

    render(<FileExplorerPanel {...defaultProps} />);
    // Let the panel's initial tree-sync attempt land, then isolate the refresh
    // that follows the rename failure.
    await waitFor(() => expect(mockRequestFileTree).toHaveBeenCalled());

    fireEvent.contextMenu(screen.getByTitle('package.json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /rename/i }));
    const input = await screen.findByLabelText('New file name');
    fireEvent.change(input, { target: { value: 'manifest.json' } });

    mockRequestFileTree.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The assertion must come after the refresh attempt, or it proves nothing.
    await waitFor(() =>
      expect(mockRequestFileTree).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/workspace',
        force: true,
      })
    );
    // Let the refresh effect's feedback updates settle before asserting; a
    // same-tick assertion can observe the message before it is wiped.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByTestId('explorer-feedback')).toHaveTextContent(
      'Failed to rename package.json: Name taken'
    );
  });
});

describe('FileExplorerPanel context-menu copy feedback', () => {
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }

  async function copyRelativePathFromContextMenu() {
    fireEvent.contextMenu(screen.getByTitle('package.json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /copy relative path/i }));
  }

  it('shows a copy failure as an alert in explorer-feedback', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);

    render(<FileExplorerPanel {...defaultProps} />);
    await copyRelativePathFromContextMenu();

    const slot = await screen.findByTestId('explorer-feedback');
    // The box variant puts role="alert" on the slot element itself, not a descendant.
    expect(slot).toHaveAttribute('role', 'alert');
    expect(slot).toHaveTextContent('Failed to copy to clipboard');
    expect(writeText).toHaveBeenCalledWith('package.json');
  });

  it('shows nothing after a successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<FileExplorerPanel {...defaultProps} />);
    await copyRelativePathFromContextMenu();

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('package.json');
    });
    expect(screen.queryByTestId('explorer-feedback')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Copied/)).not.toBeInTheDocument();
  });

  it('clears a copy failure after a successful copy', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    stubClipboard(writeText);

    render(<FileExplorerPanel {...defaultProps} />);
    await copyRelativePathFromContextMenu();
    expect(await screen.findByTestId('explorer-feedback')).toHaveTextContent(
      'Failed to copy to clipboard'
    );

    await copyRelativePathFromContextMenu();

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('explorer-feedback')).not.toBeInTheDocument();
    });
  });

  it('keeps a file-op failure when a copy succeeds', async () => {
    mockConfirmRename.mockRejectedValueOnce(new Error('Name taken'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<FileExplorerPanel {...defaultProps} />);
    // Let the panel's initial tree-sync attempt land before the rename refresh.
    await waitFor(() => expect(mockRequestFileTree).toHaveBeenCalled());

    fireEvent.contextMenu(screen.getByTitle('package.json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /rename/i }));
    const input = await screen.findByLabelText('New file name');
    fireEvent.change(input, { target: { value: 'manifest.json' } });

    mockRequestFileTree.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockRequestFileTree).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/workspace',
        force: true,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const slot = screen.getByTestId('explorer-feedback');
    expect(slot).toHaveTextContent('Failed to rename package.json: Name taken');
    expect(slot).toHaveAttribute('role', 'alert');

    await copyRelativePathFromContextMenu();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('package.json'));
    const slotAfterCopy = screen.getByTestId('explorer-feedback');
    expect(slotAfterCopy).toHaveTextContent('Failed to rename package.json: Name taken');
    expect(slotAfterCopy).toHaveAttribute('role', 'alert');
  });

  it('keeps a file-op failure that replaced a copy failure when a later copy succeeds', async () => {
    mockConfirmRename.mockRejectedValueOnce(new Error('Name taken'));
    const failingWrite = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(failingWrite);

    render(<FileExplorerPanel {...defaultProps} />);
    await waitFor(() => expect(mockRequestFileTree).toHaveBeenCalled());

    await copyRelativePathFromContextMenu();
    expect(await screen.findByTestId('explorer-feedback')).toHaveTextContent(
      'Failed to copy to clipboard'
    );

    const succeedingWrite = vi.fn().mockResolvedValue(undefined);
    stubClipboard(succeedingWrite);

    fireEvent.contextMenu(screen.getByTitle('package.json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /rename/i }));
    const input = await screen.findByLabelText('New file name');
    fireEvent.change(input, { target: { value: 'manifest.json' } });

    mockRequestFileTree.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockRequestFileTree).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/workspace',
        force: true,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByTestId('explorer-feedback')).toHaveTextContent(
      'Failed to rename package.json: Name taken'
    );

    await copyRelativePathFromContextMenu();

    await waitFor(() => expect(succeedingWrite).toHaveBeenCalledWith('package.json'));
    const slot = screen.getByTestId('explorer-feedback');
    expect(slot).toHaveTextContent('Failed to rename package.json: Name taken');
    expect(slot).toHaveAttribute('role', 'alert');
  });
});

describe('FileExplorerPanel open-on-remote feedback', () => {
  async function openFileOnRemoteFromContextMenu() {
    fireEvent.contextMenu(screen.getByTitle('package.json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /open file on remote/i }));
  }

  it('shows a refresh failure as an alert in explorer-feedback', async () => {
    mockRequestGitRefresh.mockRejectedValue(new Error('offline'));

    render(<FileExplorerPanel {...defaultProps} />);
    await openFileOnRemoteFromContextMenu();

    const slot = await screen.findByTestId('explorer-feedback');
    expect(slot).toHaveAttribute('role', 'alert');
    expect(slot).toHaveTextContent('Failed to sync repository info');
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('shows a syncing message as status text in explorer-feedback', async () => {
    render(<FileExplorerPanel {...defaultProps} />);
    await openFileOnRemoteFromContextMenu();

    const slot = await screen.findByTestId('explorer-feedback');
    expect(slot).toHaveAttribute('role', 'status');
    expect(slot).toHaveTextContent('Syncing repository info — try again in a moment');
    expect(mockRequestGitRefresh).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
    });
  });

  it('clears the previous failure when the next attempt starts', async () => {
    mockRequestGitRefresh.mockRejectedValueOnce(new Error('offline'));

    render(<FileExplorerPanel {...defaultProps} />);
    await openFileOnRemoteFromContextMenu();
    await waitFor(() =>
      expect(screen.getByTestId('explorer-feedback')).toHaveTextContent(
        'Failed to sync repository info'
      )
    );

    await openFileOnRemoteFromContextMenu();

    await waitFor(() =>
      expect(screen.getByTestId('explorer-feedback')).toHaveTextContent(
        'Syncing repository info — try again in a moment'
      )
    );
    expect(screen.queryByText('Failed to sync repository info')).not.toBeInTheDocument();
    expect(screen.getByTestId('explorer-feedback')).toHaveAttribute('role', 'status');
  });
});

describe('FileExplorerPanel truncated file copy warning', () => {
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }

  function mockFileContent(truncated: boolean) {
    vi.mocked(useFileContent).mockReturnValue({
      content: 'file body',
      encoding: 'utf8',
      truncated,
      fetchedAt: 1,
    });
  }

  async function copyFileContentFromContextMenu() {
    fireEvent.contextMenu(screen.getByTitle('package.json'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /copy file content/i }));
  }

  it('shows the truncation warning as a status in explorer-feedback', async () => {
    mockFileContent(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<FileExplorerPanel {...defaultProps} />);
    await copyFileContentFromContextMenu();

    const slot = await screen.findByTestId('explorer-feedback');
    expect(slot).toHaveAttribute('role', 'status');
    expect(slot).toHaveTextContent('Copied file content (truncated)');
    expect(writeText).toHaveBeenCalledWith('file body');
  });

  it('shows nothing after a complete file content copy', async () => {
    mockFileContent(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<FileExplorerPanel {...defaultProps} />);
    await copyFileContentFromContextMenu();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('file body'));
    expect(screen.queryByTestId('explorer-feedback')).not.toBeInTheDocument();
  });
});
