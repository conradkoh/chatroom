import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@workspace/backend/convex/_generated/api';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExplorerContent } from './ChatroomDashboard';
import type { EditorTab, UseFileTabsReturn } from './workspace/hooks/useFileTabs';

const mockRequestGitRefresh = vi.hoisted(() => vi.fn());
const idleMutation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGitState = vi.hoisted(() => ({ value: { status: 'loading' } as { status: string } }));
const mockOpenExternalUrl = vi.hoisted(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (ref: unknown) =>
    ref === api.machines.requestGitRefresh ? mockRequestGitRefresh : idleMutation,
  useSessionQuery: (ref: unknown) =>
    ref === api.workspaces.getWorkspaceGitState ? mockGitState.value : null,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machines: { requestGitRefresh: {} },
    workspaces: { getWorkspaceGitState: {} },
    workspaceFiles: { requestFileContent: {}, getFileContentV2: {} },
  },
}));

vi.mock('@/lib/navigation', () => ({
  openExternalUrl: mockOpenExternalUrl,
}));

vi.mock('./workspace/hooks/useFileContent', () => ({
  useFileContent: vi.fn(() => null),
}));

const tabs: EditorTab[] = [{ kind: 'file', filePath: 'src/a.ts', name: 'a.ts', isPinned: true }];

const fileTabs = {
  tabs,
  activeTabPath: 'src/a.ts',
  activeTabKey: 'src/a.ts',
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
  fileTabs,
  activeWorkspace: {
    workspaceId: 'ws-1',
    machineId: 'machine-1',
    workingDir: '/workspace',
  },
  autocompleteFiles: [],
  hasAutocompleteWorkspace: false,
  onAtTriggerActivate: vi.fn(),
  onOpenPreview: vi.fn(),
  onOpenTableView: vi.fn(),
  agenticFocusToken: 0,
  copyHandlers: { onCopied: vi.fn(), onCopyError: vi.fn() },
};

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGitState.value = { status: 'loading' };
  mockRequestGitRefresh.mockReset().mockResolvedValue(undefined);
  idleMutation.mockResolvedValue(undefined);
  mockOpenExternalUrl.mockReset();
});

async function openFileOnRemoteFromTabBar() {
  fireEvent.contextMenu(screen.getByTitle('src/a.ts'));
  fireEvent.click(await screen.findByRole('menuitem', { name: /open file on remote/i }));
}

describe('ExplorerContent open-on-remote feedback', () => {
  it('shows an open-on-remote failure as an alert beside the tab bar', async () => {
    mockRequestGitRefresh.mockRejectedValue(new Error('offline'));

    render(<ExplorerContent {...defaultProps} />);
    await openFileOnRemoteFromTabBar();

    const slot = await screen.findByTestId('explorer-tab-open-on-remote-feedback');
    expect(slot).toHaveAttribute('role', 'alert');
    expect(slot).toHaveTextContent('Failed to sync repository info');
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('shows the syncing message as status text', async () => {
    render(<ExplorerContent {...defaultProps} />);
    await openFileOnRemoteFromTabBar();

    const slot = await screen.findByTestId('explorer-tab-open-on-remote-feedback');
    expect(slot).toHaveAttribute('role', 'status');
    expect(slot).toHaveTextContent('Syncing repository info — try again in a moment');
    expect(mockRequestGitRefresh).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
    });
  });

  it('clears the failure when the next attempt starts', async () => {
    mockRequestGitRefresh.mockRejectedValueOnce(new Error('offline'));

    render(<ExplorerContent {...defaultProps} />);
    await openFileOnRemoteFromTabBar();
    await waitFor(() =>
      expect(screen.getByTestId('explorer-tab-open-on-remote-feedback')).toHaveTextContent(
        'Failed to sync repository info'
      )
    );

    await openFileOnRemoteFromTabBar();

    await waitFor(() =>
      expect(screen.getByTestId('explorer-tab-open-on-remote-feedback')).toHaveTextContent(
        'Syncing repository info — try again in a moment'
      )
    );
    expect(screen.queryByText('Failed to sync repository info')).not.toBeInTheDocument();
    expect(screen.getByTestId('explorer-tab-open-on-remote-feedback')).toHaveAttribute(
      'role',
      'status'
    );
  });
});
