import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileExplorerPanel, type FileExplorerPanelHandle } from './FileExplorerPanel';
import type { UseFileTabsReturn } from '../hooks/useFileTabs';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => null,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { workspaceFiles: { requestFileContent: {} } },
}));

vi.mock('../hooks/useFileContent', () => ({
  useFileContent: vi.fn(() => null),
}));

let lastRefreshSignal = 0;
let lastCollapseAllSignal = 0;
let lastExplorerProps: Record<string, unknown> = {};
let lastNewFolderProps: { open: boolean; defaultDir: string } = {
  open: false,
  defaultDir: '',
};

vi.mock('./WorkspaceFileExplorer', () => ({
  WorkspaceFileExplorer: (props: Record<string, unknown>) => {
    lastExplorerProps = props;
    lastRefreshSignal = (props.refreshSignal as number | undefined) ?? 0;
    lastCollapseAllSignal = (props.collapseAllSignal as number | undefined) ?? 0;
    return <div data-testid="file-explorer" />;
  },
}));

vi.mock('./NewFileDialog', () => ({
  NewFileDialog: () => null,
}));

vi.mock('./NewFolderDialog', () => ({
  NewFolderDialog: (props: { open: boolean; defaultDir: string }) => {
    lastNewFolderProps = props;
    return null;
  },
}));

vi.mock('./RenameDialog', () => ({
  RenameDialog: () => null,
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

vi.mock('../hooks/useExplorerFileDrop', () => ({
  useExplorerFileDrop: () => ({
    dropHighlightPath: null,
    uploadDialogOpen: false,
    pendingUpload: null,
    remainingCount: 0,
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handleUploadDialogOpenChange: vi.fn(),
  }),
}));

vi.mock('../hooks/useExplorerNewFileOps', () => ({
  useExplorerNewFileOps: () => ({
    onFileCreated: vi.fn(),
    onFileCreateFailed: vi.fn(),
    onFileCreateConfirmed: vi.fn(),
    onFileDeleteSubmitted: vi.fn(),
    onFileDeleteConfirmed: vi.fn(),
    onFileDeleteFailed: vi.fn(),
    onFileRenamed: vi.fn(),
    onFileRenameFailed: vi.fn(),
    onFileRenameConfirmed: vi.fn(),
  }),
}));

vi.mock('../hooks/useWorkspaceFileDelete', () => ({
  useWorkspaceFileDelete: () => ({
    requestDelete: vi.fn(),
    confirmDelete: vi.fn(),
  }),
}));

vi.mock('../hooks/useOpenFileOnRemote', () => ({
  useOpenFileOnRemote: () => ({
    openFileOnRemote: vi.fn(),
  }),
}));

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
  machineId: 'test-machine',
  workingDir: '/test',
  fileTabs,
  activeTabPath: null,
  fileTreeSyncEnabled: true,
  explorerSyncEnabled: false,
  onToggleSync: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  lastNewFolderProps = { open: false, defaultDir: '' };
});

describe('FileExplorerPanel refresh', () => {
  it('increments refreshSignal when the refresh button is clicked', () => {
    lastRefreshSignal = 0;
    render(<FileExplorerPanel {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Refresh files'));

    expect(lastRefreshSignal).toBe(1);
  });

  it('exposes refresh via imperative handle', () => {
    lastRefreshSignal = 0;
    const ref = createRef<FileExplorerPanelHandle>();
    render(<FileExplorerPanel {...defaultProps} ref={ref} />);

    act(() => {
      ref.current?.refresh();
    });

    expect(lastRefreshSignal).toBe(1);
  });
});

describe('FileExplorerPanel collapse all', () => {
  it('increments collapseAllSignal when collapse-all button is clicked', () => {
    lastCollapseAllSignal = 0;
    render(<FileExplorerPanel {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Collapse all folders'));

    expect(lastCollapseAllSignal).toBe(1);
  });
});

describe('FileExplorerPanel workspace root', () => {
  it('shows the workspace basename in the root folder row', () => {
    render(<FileExplorerPanel {...defaultProps} workingDir="/workspace/project" />);

    expect(screen.getByText('project')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse workspace folder project' })
    ).toBeInTheDocument();
  });

  it('hides and restores the tree when the root folder is collapsed while keeping filter visible', () => {
    render(<FileExplorerPanel {...defaultProps} workingDir="/workspace/project" />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse workspace folder project' }));

    expect(screen.queryByTestId('file-explorer')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter files…')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand workspace folder project' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand workspace folder project' }));

    expect(screen.getByTestId('file-explorer')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter files…')).toBeInTheDocument();
  });

  it('opens the new-folder flow from the root action row', () => {
    render(<FileExplorerPanel {...defaultProps} workingDir="/workspace/project" />);

    fireEvent.click(screen.getByTitle('New folder'));

    expect(lastNewFolderProps).toEqual(expect.objectContaining({ open: true, defaultDir: '' }));
  });
});

describe('FileExplorerPanel file-tree sync setting', () => {
  it('shows a disabled state pointing to Settings without mounting the file explorer', () => {
    render(<FileExplorerPanel {...defaultProps} fileTreeSyncEnabled={false} />);

    expect(screen.getByText('Workspace file tree syncing is disabled')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Enable file tree sync in Settings → Workspaces to browse this workspace's files\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable file tree sync' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-explorer')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Filter files…')).not.toBeInTheDocument();
  });

  it('disabled Explorer options contain only Sync with active editor', () => {
    render(<FileExplorerPanel {...defaultProps} fileTreeSyncEnabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Explorer options' }));

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sync with active editor' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Workspace file tree sync' })
    ).not.toBeInTheDocument();
  });

  it('enabled state renders the explorer with no enable button and only Sync with active editor in options', () => {
    render(<FileExplorerPanel {...defaultProps} fileTreeSyncEnabled />);

    expect(screen.getByTestId('file-explorer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable file tree sync' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Explorer options' }));

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sync with active editor' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Workspace file tree sync' })
    ).not.toBeInTheDocument();
  });
});

describe('FileExplorerPanel context menu', () => {
  it('passes context menu callbacks to explorer without wrapping it in ContextMenuTrigger', () => {
    render(<FileExplorerPanel {...defaultProps} />);

    expect(lastExplorerProps.onNodeContextMenu).toEqual(expect.any(Function));
    expect(lastExplorerProps.onEmptyAreaContextMenu).toEqual(expect.any(Function));
    expect(
      screen.getByTestId('file-explorer').closest('[data-slot="context-menu-trigger"]')
    ).toBeNull();
  });

  beforeEach(() => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('copies relative and full paths from the node context menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<FileExplorerPanel {...defaultProps} workingDir="/workspace/project" />);

    const node = { path: 'src/index.ts', type: 'file' as const, name: 'index.ts' };
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 20,
    });
    const openNodeMenu = () => {
      (
        lastExplorerProps.onNodeContextMenu as (
          node: { path: string; type: 'file' | 'directory'; name: string },
          event: MouseEvent
        ) => void
      )(node, event);
    };

    act(openNodeMenu);

    fireEvent.click(await screen.findByText('Copy Relative Path'));
    expect(writeText).toHaveBeenCalledWith('src/index.ts');

    act(openNodeMenu);

    fireEvent.click(await screen.findByText('Copy Full Path'));
    expect(writeText).toHaveBeenCalledWith('/workspace/project/src/index.ts');
  });

  it('copies file name from the node context menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<FileExplorerPanel {...defaultProps} workingDir="/workspace/project" />);

    const node = { path: 'src/index.ts', type: 'file' as const, name: 'index.ts' };
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 20,
    });
    const openNodeMenu = () => {
      (
        lastExplorerProps.onNodeContextMenu as (
          node: { path: string; type: 'file' | 'directory'; name: string },
          event: MouseEvent
        ) => void
      )(node, event);
    };

    act(openNodeMenu);

    fireEvent.click(await screen.findByText('Copy File Name'));
    expect(writeText).toHaveBeenCalledWith('index.ts');
  });
});
