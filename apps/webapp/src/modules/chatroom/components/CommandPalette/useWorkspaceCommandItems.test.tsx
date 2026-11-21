import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceCommandItems } from './useWorkspaceCommandItems';
import type { Workspace } from '../../types/workspace';

const mocks = vi.hoisted(() => ({
  useWorkspaceGit: vi.fn(),
}));

vi.mock('../../workspace/hooks/useWorkspaceGit', () => ({
  useWorkspaceGit: mocks.useWorkspaceGit,
}));

const MACHINE_ID = 'machine-a';
const WORKING_DIR = '/Users/conradkoh/Documents/Repos/chatroom';

function mkWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: `${MACHINE_ID}::${WORKING_DIR}`,
    machineId: MACHINE_ID,
    hostname: 'host-a',
    workingDir: WORKING_DIR,
    agentRoles: [],
    fileTreeSyncEnabled: true,
    ...overrides,
  };
}

function mkCallbacks() {
  return {
    sendAction: vi.fn(),
    openExternalUrl: vi.fn(),
    onOpenGitPanel: vi.fn(),
    onCopied: vi.fn(),
    onCopyError: vi.fn(),
  };
}

describe('useWorkspaceCommandItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceGit.mockReturnValue({ status: 'loading' });
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('exposes all machine actions from machine metadata without daemon status', () => {
    const callbacks = mkCallbacks();
    const workspace = mkWorkspace();
    const { result } = renderHook(() =>
      useWorkspaceCommandItems(workspace, false, callbacks, 'chatroom-1')
    );

    const machineActionSuffixes = [
      'open-vscode',
      'open-github-desktop',
      'copy-workspace-path',
      'open-finder',
      'open-cursor',
      'view-daemon-logs',
    ];
    const commandIds = result.current.map((command) => command.id);

    expect(commandIds).toEqual(
      expect.arrayContaining(machineActionSuffixes.map((suffix) => `ws-${workspace.id}-${suffix}`))
    );
    expect(mocks.useWorkspaceGit).toHaveBeenCalledWith(MACHINE_ID, WORKING_DIR);

    const command = (suffix: string) =>
      result.current.find((item) => item.id === `ws-${workspace.id}-${suffix}`);

    act(() => command('open-vscode')?.action());
    act(() => command('open-github-desktop')?.action());
    act(() => command('open-finder')?.action());
    act(() => command('open-cursor')?.action());
    act(() => command('view-daemon-logs')?.action());

    expect(callbacks.sendAction).toHaveBeenNthCalledWith(1, MACHINE_ID, 'open-vscode', WORKING_DIR);
    expect(callbacks.sendAction).toHaveBeenNthCalledWith(
      2,
      MACHINE_ID,
      'open-github-desktop',
      WORKING_DIR
    );
    expect(callbacks.sendAction).toHaveBeenNthCalledWith(3, MACHINE_ID, 'open-finder', WORKING_DIR);
    expect(callbacks.sendAction).toHaveBeenNthCalledWith(4, MACHINE_ID, 'open-cursor', WORKING_DIR);
    expect(callbacks.sendAction).toHaveBeenNthCalledWith(
      5,
      MACHINE_ID,
      'open-daemon-logs',
      WORKING_DIR,
      { chatroomId: 'chatroom-1' }
    );

    act(() => command('copy-workspace-path')?.action());
    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(WORKING_DIR);
  });

  it('reports a rejected workspace-path copy to onCopyError', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const callbacks = mkCallbacks();
    const workspace = mkWorkspace();
    const { result } = renderHook(() => useWorkspaceCommandItems(workspace, false, callbacks));

    const command = result.current.find(
      (item) => item.id === `ws-${workspace.id}-copy-workspace-path`
    );

    await act(async () => {
      command?.action();
    });

    expect(writeText).toHaveBeenCalledWith(WORKING_DIR);
    expect(callbacks.onCopyError).toHaveBeenCalledTimes(1);
    expect(callbacks.onCopyError).toHaveBeenCalledWith('Failed to copy to clipboard');
    expect(callbacks.onCopied).not.toHaveBeenCalled();
  });

  it('reports a successful workspace-path copy to onCopied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const callbacks = mkCallbacks();
    const workspace = mkWorkspace();
    const { result } = renderHook(() => useWorkspaceCommandItems(workspace, false, callbacks));

    const command = result.current.find(
      (item) => item.id === `ws-${workspace.id}-copy-workspace-path`
    );

    await act(async () => {
      command?.action();
    });

    expect(writeText).toHaveBeenCalledWith(WORKING_DIR);
    expect(callbacks.onCopied).toHaveBeenCalledTimes(1);
    expect(callbacks.onCopyError).not.toHaveBeenCalled();
  });

  it('omits machine actions without a machine while retaining git and workspace commands', () => {
    const workspace = mkWorkspace({ id: '__unassigned__', machineId: null, workingDir: '/repo' });
    mocks.useWorkspaceGit.mockReturnValue({
      status: 'available',
      branch: 'main',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      openPullRequests: [],
      remotes: [{ name: 'origin', url: 'git@github.com:owner/repo.git' }],
      commitsAhead: 0,
      commitsBehind: 0,
      updatedAt: 1,
    });

    const { result } = renderHook(() => useWorkspaceCommandItems(workspace, false, mkCallbacks()));
    const commandIds = result.current.map((command) => command.id);

    for (const suffix of [
      'open-vscode',
      'open-github-desktop',
      'copy-workspace-path',
      'open-finder',
      'open-cursor',
      'view-daemon-logs',
    ]) {
      expect(commandIds).not.toContain(`ws-${workspace.id}-${suffix}`);
    }
    expect(commandIds).toEqual(
      expect.arrayContaining([
        `ws-${workspace.id}-workspace-details`,
        `ws-${workspace.id}-view-repo`,
        `ws-${workspace.id}-git-diff`,
        `ws-${workspace.id}-git-pull`,
      ])
    );
    expect(mocks.useWorkspaceGit).toHaveBeenCalledWith('', '/repo');
  });
});
