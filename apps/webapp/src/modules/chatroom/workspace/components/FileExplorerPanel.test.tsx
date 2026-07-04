import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FileExplorerPanel, type FileExplorerPanelHandle } from './FileExplorerPanel';
import type { UseFileTabsReturn } from '../hooks/useFileTabs';

let lastRefreshSignal = 0;

vi.mock('./WorkspaceFileExplorer', () => ({
  WorkspaceFileExplorer: ({ refreshSignal }: { refreshSignal?: number }) => {
    lastRefreshSignal = refreshSignal ?? 0;
    return <div data-testid="file-explorer" />;
  },
}));

vi.mock('./NewFileDialog', () => ({
  NewFileDialog: () => null,
}));

vi.mock('../hooks/useExplorerNewFileOps', () => ({
  useExplorerNewFileOps: () => ({
    onFileCreated: vi.fn(),
    onFileCreateFailed: vi.fn(),
    onFileCreateConfirmed: vi.fn(),
    onFileDeleteSubmitted: vi.fn(),
    onFileDeleteConfirmed: vi.fn(),
    onFileDeleteFailed: vi.fn(),
  }),
}));

vi.mock('../hooks/useWorkspaceFileDelete', () => ({
  useWorkspaceFileDelete: () => ({
    requestDelete: vi.fn(),
    confirmDelete: vi.fn(),
  }),
}));

const fileTabs = {
  tabs: [],
  activeTabPath: null,
  expandedTabPath: null,
  openPreview: vi.fn(),
  pinTab: vi.fn(),
  closeTab: vi.fn(),
  setActiveTab: vi.fn(),
  toggleExpanded: vi.fn(),
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
