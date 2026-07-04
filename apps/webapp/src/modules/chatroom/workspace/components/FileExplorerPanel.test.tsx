import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FILE_EXPLORER_REFRESH_EVENT } from './fileExplorerEvents';
import { FileExplorerPanel } from './FileExplorerPanel';
import type { UseFileTabsReturn } from '../hooks/useFileTabs';

let explorerMountCount = 0;

vi.mock('./WorkspaceFileExplorer', () => ({
  WorkspaceFileExplorer: () => {
    explorerMountCount += 1;
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

describe('FileExplorerPanel refresh event', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    explorerMountCount = 0;
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  it('does not re-dispatch when handling an external refresh event', async () => {
    render(<FileExplorerPanel {...defaultProps} />);
    dispatchSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(FILE_EXPLORER_REFRESH_EVENT));
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(explorerMountCount).toBe(2);
  });

  it('dispatches exactly once when the refresh button is clicked', () => {
    render(<FileExplorerPanel {...defaultProps} />);
    dispatchSpy.mockClear();

    fireEvent.click(screen.getByTitle('Refresh files'));

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
    expect((dispatchSpy.mock.calls[0]?.[0] as CustomEvent).type).toBe(FILE_EXPLORER_REFRESH_EVENT);
    expect(explorerMountCount).toBe(2);
  });
});
