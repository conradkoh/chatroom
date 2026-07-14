import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitWorkspaceHierarchy } from './git-workspace-hierarchy.js';

const mockPorcelain = vi.hoisted(() => ({
  readGitHead: vi.fn(),
  readGitPorcelainStatus: vi.fn(),
  diffPorcelainSnapshots: vi.fn(),
  headChanged: vi.fn(),
  porcelainPathsLeftSnapshot: vi.fn(),
}));

vi.mock('./git-workspace-porcelain.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readGitHead: mockPorcelain.readGitHead,
    readGitPorcelainStatus: mockPorcelain.readGitPorcelainStatus,
    diffPorcelainSnapshots: mockPorcelain.diffPorcelainSnapshots,
    headChanged: mockPorcelain.headChanged,
    porcelainPathsLeftSnapshot: mockPorcelain.porcelainPathsLeftSnapshot,
  };
});

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

const nestedHierarchy: GitWorkspaceHierarchy = {
  workspaceRoot: '/workspace',
  root: {
    workTree: '/workspace',
    gitDir: '/workspace/.git',
    relativePath: '',
    pathspec: [],
    children: [
      {
        workTree: '/workspace/vendor/lib',
        gitDir: '/workspace/.git/modules/vendor/lib',
        relativePath: 'vendor/lib',
        pathspec: [],
        children: [],
      },
    ],
  },
};

describe('git-workspace-change-source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPorcelain.readGitHead.mockReset();
    mockPorcelain.readGitPorcelainStatus.mockReset();
    mockPorcelain.diffPorcelainSnapshots.mockReset();
    mockPorcelain.headChanged.mockReset();
    mockPorcelain.porcelainPathsLeftSnapshot.mockReset();
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
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
    });

    await source.ready;

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
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

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

  it('calls onNeedsReconcile when HEAD changes after baseline', async () => {
    const onNeedsReconcile = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents: vi.fn(),
      onNeedsReconcile,
    });

    await source.ready;
    expect(onNeedsReconcile).not.toHaveBeenCalled();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'def' });
    mockPorcelain.headChanged.mockReturnValue(true);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(onNeedsReconcile).toHaveBeenCalled();
    });

    await source.stop();
  });

  it('does not call onNeedsReconcile on initial HEAD baseline', async () => {
    const onNeedsReconcile = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.headChanged.mockReturnValue(true);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents: vi.fn(),
      onNeedsReconcile,
    });

    await source.ready;
    expect(onNeedsReconcile).not.toHaveBeenCalled();
    await source.stop();
  });

  it('stop clears timer and does not emit after stop', async () => {
    const onEvents = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

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
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
      shouldIgnore,
    });

    await source.ready;

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

  it('skips porcelain events on initial baseline without getKnownPaths', async () => {
    const onEvents = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([{ xy: '??', path: 'dirty.txt' }]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
    });

    await source.ready;

    // First poll (baseline): diffPorcelainSnapshots should NOT be called
    expect(mockPorcelain.diffPorcelainSnapshots).not.toHaveBeenCalled();
    expect(onEvents).not.toHaveBeenCalled();

    // Second poll: now diff is called
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {});

    expect(mockPorcelain.diffPorcelainSnapshots).toHaveBeenCalledTimes(1);

    await source.stop();
  });

  it('emits add on baseline for porcelain paths missing from getKnownPaths', async () => {
    const onEvents = vi.fn();
    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([{ xy: '??', path: 'stale.txt' }]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      getKnownPaths: () => ({ 'README.md': 'file' }),
      onEvents,
    });

    await source.ready;
    await vi.waitFor(() => {
      expect(onEvents).toHaveBeenCalledWith([{ kind: 'add', path: 'stale.txt' }]);
    });
    expect(mockPorcelain.diffPorcelainSnapshots).not.toHaveBeenCalled();
    await source.stop();
  });

  it('calls onNeedsReconcile when porcelainPathsLeftSnapshot returns paths', async () => {
    const onNeedsReconcile = vi.fn();
    const onEvents = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([{ xy: ' M', path: 'f.txt' }]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
      onNeedsReconcile,
    });

    await source.ready;

    // Second poll: f.txt leaves porcelain
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue(['f.txt']);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(onNeedsReconcile).toHaveBeenCalled();
    });
    // No events emitted (path left without D)
    expect(onEvents).not.toHaveBeenCalled();

    await source.stop();
  });

  it('emits unlink via onEvents when untracked file leaves porcelain and is deleted', async () => {
    const onEvents = vi.fn();
    const onNeedsReconcile = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus
      .mockResolvedValueOnce([{ xy: '??', path: 'gone.txt' }])
      .mockResolvedValueOnce([]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue(['gone.txt']);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
      onNeedsReconcile,
    });
    await source.ready;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(onEvents).toHaveBeenCalledWith([{ kind: 'unlink', path: 'gone.txt' }]);
    });
    expect(onNeedsReconcile).not.toHaveBeenCalled();
    await source.stop();
  });

  it('does not update state when readGitPorcelainStatus throws', async () => {
    const onEvents = vi.fn();
    const onError = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([{ xy: ' M', path: 'f.txt' }]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 1000,
      onEvents,
      onError,
    });

    await source.ready;

    // Second poll: git command fails
    const gitError = new Error('git status failed');
    mockPorcelain.readGitPorcelainStatus.mockRejectedValue(gitError);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(gitError);
    });

    // Third poll: succeeds again — should diff against first poll's state
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.diffPorcelainSnapshots.mockResolvedValue([]);
    // porcelainPathsLeftSnapshot should receive prev from first poll (f.txt present)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      // porcelainPathsLeftSnapshot was called at least once (second poll)
      expect(mockPorcelain.porcelainPathsLeftSnapshot).toHaveBeenCalled();
    });

    await source.stop();
  });

  it('calls onPersistentFailure after 3 consecutive failure ticks', async () => {
    const onPersistentFailure = vi.fn();
    const onError = vi.fn();
    const gitError = new Error('git status failed');

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockRejectedValue(gitError);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy,
      pollIntervalMs: 100,
      onEvents: vi.fn(),
      onError,
      onPersistentFailure,
    });

    // First failure tick (0 → 100ms)
    await source.ready;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onPersistentFailure).not.toHaveBeenCalled();

    // Second failure tick (100ms → 200ms)
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {});
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onPersistentFailure).not.toHaveBeenCalled();

    // Third failure tick (200ms → 300ms) — triggers onPersistentFailure
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(onPersistentFailure).toHaveBeenCalledTimes(1);
    });

    // Fourth failure tick — onPersistentFailure NOT called again
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {});
    expect(onPersistentFailure).toHaveBeenCalledTimes(1);

    await source.stop();
  });

  it('polls nested child node', async () => {
    const onEvents = vi.fn();

    mockPorcelain.readGitHead.mockResolvedValue({ head: 'abc' });
    mockPorcelain.readGitPorcelainStatus.mockResolvedValue([]);
    mockPorcelain.headChanged.mockReturnValue(false);
    mockPorcelain.diffPorcelainSnapshots.mockReturnValue([]);
    mockPorcelain.porcelainPathsLeftSnapshot.mockReturnValue([]);

    const source = createGitWorkspaceChangeSource({
      workingDir: '/workspace',
      hierarchy: nestedHierarchy,
      pollIntervalMs: 1000,
      onEvents,
    });

    // First poll (baseline): both nodes polled
    expect(mockPorcelain.readGitPorcelainStatus).toHaveBeenCalledTimes(2);
    expect(mockPorcelain.readGitHead).toHaveBeenCalledTimes(2);

    // Second poll
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {});
    expect(mockPorcelain.readGitPorcelainStatus).toHaveBeenCalledTimes(4);
    expect(mockPorcelain.readGitHead).toHaveBeenCalledTimes(4);

    await source.stop();
  });
});
