import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitWorkspaceHierarchy } from './git-workspace-hierarchy.js';

const mockPorcelain = vi.hoisted(() => ({
  readGitHead: vi.fn(),
  readGitPorcelainStatus: vi.fn(),
  diffPorcelainSnapshots: vi.fn(),
  headChanged: vi.fn(),
}));

vi.mock('./git-workspace-porcelain.js', () => mockPorcelain);

const { createGitWorkspaceChangeSource } = await import('./git-workspace-change-source.js');

const hierarchy: GitWorkspaceHierarchy = {
  workspaceRoot: '/workspace',
  root: {
    workTree: '/workspace',
    gitDir: '/workspace/.git',
    relativePath: '',
    pathspec: [],
    children: [],
  },
};

describe('git-workspace-change-source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPorcelain.readGitHead.mockReset();
    mockPorcelain.readGitPorcelainStatus.mockReset();
    mockPorcelain.diffPorcelainSnapshots.mockReset();
    mockPorcelain.headChanged.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('emits add when porcelain gains ?? file between polls', async () => {
    const onEvents = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
    });

    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([{ xy: '??', path: 'new.txt' }]);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([{ kind: 'add', path: 'new.txt' }]);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(onEvents).toHaveBeenCalledWith([{ kind: 'add', path: 'new.txt' }]);
    });

    await source.stop();
  });

  it('does not emit unlink when path leaves porcelain without delete', async () => {
    const onEvents = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([{ xy: ' M', path: 'f.txt' }]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
    });

    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {});
    expect(onEvents).not.toHaveBeenCalled();

    await source.stop();
  });

  it('calls onNeedsReconcile when HEAD changes', async () => {
    const onNeedsReconcile = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents: vi.fn(),
      onNeedsReconcile,
    });

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'def' });
    mockPorcelain.headChanged.mockReturnValue(true);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(onNeedsReconcile).toHaveBeenCalled();
    });

    await source.stop();
  });

  it('stop clears timer and does not emit after stop', async () => {
    const onEvents = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
    });

    await source.stop();

    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([{ xy: '??', path: 'new.txt' }]);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([{ kind: 'add', path: 'new.txt' }]);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {});
    expect(onEvents).not.toHaveBeenCalled();
  });

  it('applies shouldIgnore', async () => {
    const onEvents = vi.fn();
    const shouldIgnore = vi.fn((p: string) => p.startsWith('ignored/'));

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
      shouldIgnore,
    });

    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([
      { xy: '??', path: 'visible.txt' },
      { xy: '??', path: 'ignored/hidden.txt' },
    ]);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([
      { kind: 'add', path: 'visible.txt' },
      { kind: 'add', path: 'ignored/hidden.txt' },
    ]);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(onEvents).toHaveBeenCalledWith([{ kind: 'add', path: 'visible.txt' }]);
    });
    expect(shouldIgnore).toHaveBeenCalledWith('visible.txt');
    expect(shouldIgnore).toHaveBeenCalledWith('ignored/hidden.txt');

    await source.stop();
  });
});
