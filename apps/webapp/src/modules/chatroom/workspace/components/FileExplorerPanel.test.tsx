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
let lastExplorerProps: Record<string, unknown> = {};

vi.mock('./WorkspaceFileExplorer', () => ({
  WorkspaceFileExplorer: (props: Record<string, unknown>) => {
    lastExplorerProps = props;
    lastRefreshSignal = (props.refreshSignal as number | undefined) ?? 0;
    return <div data-testid="file-explorer" />;
  },
}));

vi.mock('./NewFileDialog', () => ({
  NewFileDialog: () => null,
}));

vi.mock('./NewFolderDialog', () => ({
  NewFolderDialog: () => null,
}));

vi.mock('./RenameDialog', () => ({
  RenameDialog: () => null,
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
  machineId: 'test-machine',
  workingDir: '/test',
  fileTabs,
  activeTabPath: null,
  explorerSyncEnabled: false,
  onToggleSync: vi.fn(),
};

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
