import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueueModule from './remote-poll-queue.js';
import type * as MonitorModule from './workspace-monitor.js';
import {
  createWorkspaceService,
  type WorkspaceService,
  type WorkspaceServiceDeps,
} from './workspace-service.js';
import type { WorkspaceActivityRow } from '../domain/observation-tier.js';
import {
  LOCAL_KINDS,
  type LocalKind,
  type WorkspaceStateUnit,
} from '../domain/workspace-state-unit.js';
import {
  DEFAULT_WORKSPACE_SYNC_POLICY,
  resolveWorkspaceSyncPolicy,
  type DeepPartial,
  type WorkspaceSyncPolicy,
} from '../domain/workspace-sync-policy.js';
import type { LocalCollectResult } from '../infrastructure/local-unit-collector.js';
import type { RemoteCollectResult } from '../infrastructure/remote-unit-collector.js';
import type { WorkspaceActivitySource } from '../infrastructure/workspace-activity-source.js';
import type { ProbeSnapshot, WorkspaceGitProbe } from '../infrastructure/workspace-git-probe.js';

/**
 * Ordered record of the stop path. The monitor and queue mocks below are passthroughs that only
 * append to it, so stop order can be asserted without changing behaviour.
 */
const stopOrder = vi.hoisted(() => [] as string[]);

vi.mock('./workspace-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof MonitorModule>();
  return {
    ...actual,
    createWorkspaceMonitor: (deps: Parameters<typeof MonitorModule.createWorkspaceMonitor>[0]) => {
      const monitor = actual.createWorkspaceMonitor(deps);
      return {
        ...monitor,
        stop: () => {
          stopOrder.push(`monitor:${deps.workingDir}`);
          return monitor.stop();
        },
      };
    },
  };
});

vi.mock('./remote-poll-queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof QueueModule>();
  return {
    ...actual,
    createRemotePollQueue: (deps: Parameters<typeof QueueModule.createRemotePollQueue>[0]) => {
      const queue = actual.createRemotePollQueue(deps);
      return {
        ...queue,
        stopAll: () => {
          stopOrder.push('queue.stopAll');
          return queue.stopAll();
        },
      };
    },
  };
});

const START = 1_000_000;
const DIR_A = '/repo-a';
const DIR_B = '/repo-b';
const PROBE = DEFAULT_WORKSPACE_SYNC_POLICY.probeIntervalMs;
const MIN_GAP = DEFAULT_WORKSPACE_SYNC_POLICY.remote.minGapMs;
const IDLE_AFTER =
  DEFAULT_WORKSPACE_SYNC_POLICY.observation.ttlMs +
  DEFAULT_WORKSPACE_SYNC_POLICY.observation.graceMs;
const HOT = DEFAULT_WORKSPACE_SYNC_POLICY.remote.hotIntervalMs;

/** Mutable state of one fake git repository. Tests change it to simulate git activity. */
type FakeRepo = { oid: string; dirty: number; hasRemote: boolean };

const OK_REMOTE: RemoteCollectResult = {
  ok: true,
  units: [
    { kind: 'pullRequests', openPullRequests: [] },
    { kind: 'checks', headCommitStatus: null },
  ],
  checksState: null,
};

function localResult(repo: FakeRepo, kinds: ReadonlySet<LocalKind>): LocalCollectResult {
  const units: WorkspaceStateUnit[] = [{ kind: 'head', status: 'available', branch: 'main' }];
  if (kinds.has('worktree')) {
    units.push({
      kind: 'worktree',
      isDirty: repo.dirty > 0,
      diffStat: { filesChanged: repo.dirty, insertions: 0, deletions: 0 },
    });
  }
  if (kinds.has('upstream')) units.push({ kind: 'upstream', commitsAhead: 0, commitsBehind: 0 });
  if (kinds.has('remotes')) {
    units.push({
      kind: 'remotes',
      remotes: repo.hasRemote ? [{ name: 'origin', url: 'git@example.com:repo.git' }] : [],
    });
  }
  if (kinds.has('recentCommits')) {
    units.push({
      kind: 'recentCommits',
      commits: [
        { sha: repo.oid, shortSha: repo.oid.slice(0, 7), message: 'm', author: 'a', date: 'd' },
      ],
      hasMoreCommits: false,
    });
  }
  if (kinds.has('commands')) units.push({ kind: 'commands', commands: [] });
  return { units, headAvailable: true, branch: 'main', hasRemote: repo.hasRemote };
}

function snapshotOf(repo: FakeRepo): ProbeSnapshot {
  return {
    branch: { oid: repo.oid, head: 'main', upstream: 'origin/main', ahead: 0, behind: 0 },
    entries: Array.from({ length: repo.dirty }, (_, i) => ({ xy: ' M', path: `f${i}.ts` })),
    dirtyStats: new Map(),
    statCapped: false,
    readAt: Date.now(),
  };
}

/** Pushes snapshots to the service. Throws when the service is not subscribed. */
function fakeActivitySource() {
  let onRows: ((rows: readonly WorkspaceActivityRow[]) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    stopOrder.push('unsubscribe');
    onRows = null;
  });
  const source: WorkspaceActivitySource = {
    subscribe: vi.fn((cb: (rows: readonly WorkspaceActivityRow[]) => void) => {
      onRows = cb;
      return unsubscribe;
    }),
  };
  return {
    source,
    unsubscribe,
    push(rows: WorkspaceActivityRow[]) {
      if (onRows === null) throw new Error('activity source is not subscribed');
      onRows(rows);
    },
  };
}

function setup(overrides?: DeepPartial<WorkspaceSyncPolicy>) {
  const policy = resolveWorkspaceSyncPolicy(overrides);
  const repos = new Map<string, FakeRepo>();
  const repoOf = (dir: string): FakeRepo => {
    let repo = repos.get(dir);
    if (!repo) {
      repo = { oid: `${dir}-1`, dirty: 0, hasRemote: true };
      repos.set(dir, repo);
    }
    return repo;
  };
  const probeReads = new Map<string, number>();
  const remoteCalls: { workingDir: string; at: number }[] = [];

  const activity = fakeActivitySource();
  const outbox = {
    enqueue: vi.fn<(workingDir: string, unit: WorkspaceStateUnit) => void>(),
    stopKeys: vi.fn<(workingDir: string) => void>(),
  };
  const createProbe = vi.fn((workingDir: string): WorkspaceGitProbe => ({
    workTree: workingDir,
    rootPathspec: [],
    readSnapshot: async (_opts: { maxAgeMs: number }) => {
      probeReads.set(workingDir, (probeReads.get(workingDir) ?? 0) + 1);
      return snapshotOf(repoOf(workingDir));
    },
  }));
  const collectLocal = vi.fn(
    async (workingDir: string, kinds: ReadonlySet<LocalKind>): Promise<LocalCollectResult> =>
      localResult(repoOf(workingDir), kinds)
  );
  const collectRemote = vi.fn(
    async (workingDir: string, _branch: string): Promise<RemoteCollectResult> => {
      remoteCalls.push({ workingDir, at: Date.now() });
      return OK_REMOTE;
    }
  );

  const service: WorkspaceService = createWorkspaceService({
    activitySource: activity.source,
    outbox,
    policy,
    createProbe,
    collectLocal,
    collectRemote,
    sessionId: 'workspace-service-test-session' as WorkspaceServiceDeps['sessionId'],
    machineId: 'workspace-service-test',
    backend: { mutation: vi.fn(async () => undefined), query: vi.fn(async () => null) },
  });

  return {
    service,
    policy,
    activity,
    outbox,
    createProbe,
    collectLocal,
    repoOf,
    probeReads,
    remoteCalls,
    push: (rows: WorkspaceActivityRow[]) => activity.push(rows),
    /** Advances fake time and lets the promise chains settle between timers. */
    advance: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

type Harness = ReturnType<typeof setup>;

/** Rows that are observed at the current fake time for each directory. */
function observedNow(...workingDirs: string[]): WorkspaceActivityRow[] {
  return workingDirs.map((workingDir) => ({ workingDir, lastObservedAt: Date.now() }));
}

function enqueuedFor(h: Harness, workingDir: string): WorkspaceStateUnit[] {
  return h.outbox.enqueue.mock.calls.filter(([dir]) => dir === workingDir).map(([, unit]) => unit);
}

function remoteTimesFor(h: Harness, workingDir: string): number[] {
  return h.remoteCalls.filter((call) => call.workingDir === workingDir).map((call) => call.at);
}

describe('createWorkspaceService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    stopOrder.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates one monitor per active directory and emits head for each', async () => {
    const h = setup();
    h.service.start();

    h.push(observedNow(DIR_A, DIR_B));
    await h.advance(0);

    expect(h.service.isRegistered(DIR_A)).toBe(true);
    expect(h.service.isRegistered(DIR_B)).toBe(true);
    expect(h.createProbe).toHaveBeenCalledTimes(2);
    for (const dir of [DIR_A, DIR_B]) {
      expect(enqueuedFor(h, dir).map((unit) => unit.kind)).toContain('head');
    }
  });

  it('runs a full recompute and arms the probe when observed, then stops both when idle', async () => {
    const h = setup();
    h.service.start();
    h.push(observedNow(DIR_A));
    await h.advance(0);

    expect(h.collectLocal).toHaveBeenCalledWith(DIR_A, new Set(LOCAL_KINDS));
    await h.advance(PROBE);
    expect(h.probeReads.get(DIR_A)).toBeGreaterThan(0);

    // No new snapshot arrives. The observation decays on its own at the transition time.
    await h.advance(IDLE_AFTER);
    const readsAtIdle = h.probeReads.get(DIR_A);
    const enqueuesAtIdle = h.outbox.enqueue.mock.calls.length;
    h.repoOf(DIR_A).dirty = 3;
    await h.advance(10 * 60_000);

    expect(h.probeReads.get(DIR_A)).toBe(readsAtIdle);
    expect(h.outbox.enqueue).toHaveBeenCalledTimes(enqueuesAtIdle);
  });

  it('re-observes a decayed directory when a newer snapshot arrives', async () => {
    const h = setup();
    h.service.start();
    h.push(observedNow(DIR_A));
    await h.advance(0);
    await h.advance(IDLE_AFTER);
    const recomputesWhileIdle = h.collectLocal.mock.calls.length;
    const readsWhileIdle = h.probeReads.get(DIR_A) ?? 0;

    h.push(observedNow(DIR_A));
    await h.advance(0);
    expect(h.collectLocal.mock.calls.length - recomputesWhileIdle).toBe(1);
    expect(h.collectLocal).toHaveBeenLastCalledWith(DIR_A, new Set(LOCAL_KINDS));
    await h.advance(PROBE);

    expect(h.probeReads.get(DIR_A) ?? 0).toBeGreaterThan(readsWhileIdle);
  });

  it('stops a removed directory: cancels its remote timer, drops its keys, and emits nothing later', async () => {
    const h = setup();
    h.service.start();
    h.push(observedNow(DIR_A, DIR_B));
    await h.advance(0);

    h.push(observedNow(DIR_B));
    await h.advance(0);
    expect(h.service.isRegistered(DIR_A)).toBe(false);
    expect(h.outbox.stopKeys).toHaveBeenCalledWith(DIR_A);
    expect(h.outbox.stopKeys).not.toHaveBeenCalledWith(DIR_B);

    const enqueuesAtRemoval = enqueuedFor(h, DIR_A).length;
    const remoteAtRemoval = remoteTimesFor(h, DIR_A).length;
    const readsAtRemoval = h.probeReads.get(DIR_A) ?? 0;
    const repo = h.repoOf(DIR_A);
    repo.oid = 'changed';
    repo.dirty = 4;
    await h.advance(10 * 60_000);

    expect(enqueuedFor(h, DIR_A)).toHaveLength(enqueuesAtRemoval);
    expect(remoteTimesFor(h, DIR_A)).toHaveLength(remoteAtRemoval);
    expect(h.probeReads.get(DIR_A) ?? 0).toBe(readsAtRemoval);
  });

  it('drops units from a recompute still in flight when its directory is removed', async () => {
    const h = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.collectLocal.mockImplementationOnce(async (workingDir, kinds) => {
      await gate;
      return localResult(h.repoOf(workingDir), kinds);
    });
    h.service.start();
    h.push(observedNow(DIR_A));
    await h.advance(0);

    h.push([]);
    await h.advance(0);
    release();
    await h.advance(0);

    expect(h.outbox.stopKeys).toHaveBeenCalledWith(DIR_A);
    expect(enqueuedFor(h, DIR_A)).toEqual([]);
  });

  it('refresh on an unregistered directory does nothing and creates no monitor', async () => {
    const h = setup();
    h.service.start();

    await h.service.refresh('/not-registered', 'command');

    expect(h.createProbe).not.toHaveBeenCalled();
    expect(h.collectLocal).not.toHaveBeenCalled();
    expect(h.service.isRegistered('/not-registered')).toBe(false);
  });

  it('refresh on a registered directory re-enqueues every local unit and schedules one remote poll', async () => {
    const h = setup();
    h.service.start();
    h.push(observedNow(DIR_A));
    await h.advance(0);
    const remoteBefore = remoteTimesFor(h, DIR_A).length;
    h.outbox.enqueue.mockClear();

    // A trailing slash normalizes to the registered key.
    await h.service.refresh(`${DIR_A}/`, 'command');
    await h.advance(MIN_GAP);

    const localKinds = new Set<string>(LOCAL_KINDS);
    const localEnqueued = enqueuedFor(h, DIR_A)
      .map((unit) => unit.kind)
      .filter((kind) => localKinds.has(kind));
    expect(localEnqueued).toEqual([...LOCAL_KINDS]);
    expect(remoteTimesFor(h, DIR_A).length - remoteBefore).toBe(1);
  });

  it('stopAll unsubscribes, leaves no timers pending, and ignores later snapshots', async () => {
    const h = setup();
    h.service.start();
    h.push(observedNow(DIR_A, DIR_B));
    await h.advance(PROBE + 1_000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await h.service.stopAll();

    expect(h.activity.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.service.isRegistered(DIR_A)).toBe(false);
    expect(() => h.push(observedNow(DIR_A))).toThrow('not subscribed');
  });

  /**
   * Replaces the file-tree stop with a recorder. With `reject`, the recorded stop then rejects, so
   * the test can check what runs after a file-tree failure.
   */
  function recordFileTreeStop(h: Harness, reject?: Error): void {
    const original = h.service.fileTree.stopAll.bind(h.service.fileTree);
    vi.spyOn(h.service.fileTree, 'stopAll').mockImplementation(async () => {
      stopOrder.push('fileTree.stopAll');
      if (reject) throw reject;
      await original();
    });
  }

  it('stopAll unsubscribes first, then stops every monitor, then the file tree, then the remote queue', async () => {
    const h = setup();
    h.service.start();
    h.push(observedNow(DIR_A, DIR_B));
    await h.advance(0);
    recordFileTreeStop(h);

    await h.service.stopAll();

    expect(stopOrder.at(0)).toBe('unsubscribe');
    const monitorStops = stopOrder.slice(1, -2);
    expect(monitorStops).toHaveLength(2);
    expect(monitorStops.every((call) => call.startsWith('monitor:'))).toBe(true);
    expect(stopOrder.slice(-2)).toEqual(['fileTree.stopAll', 'queue.stopAll']);
  });

  it('a file-tree stop failure is logged, and the remote queue still stops', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = setup();
    h.service.start();
    h.push(observedNow(DIR_A));
    await h.advance(0);
    recordFileTreeStop(h, new Error('file-tree stop failed'));

    await expect(h.service.stopAll()).resolves.toBeUndefined();

    expect(stopOrder.at(-2)).toBe('fileTree.stopAll');
    expect(stopOrder.at(-1)).toBe('queue.stopAll');
    expect(warn).toHaveBeenCalledWith(
      '[workspace-service] file-tree stop failed',
      expect.any(Error)
    );
  });

  it('start subscribes only once', () => {
    const h = setup();

    h.service.start();
    h.service.start();

    expect(h.activity.source.subscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps one remote timer per workspace: refreshing A does not move B', async () => {
    const h = setup();
    h.service.start();
    h.push(observedNow(DIR_A, DIR_B));
    await h.advance(0);
    const bStart = remoteTimesFor(h, DIR_B)[0];

    // A's refresh schedules A on the shared queue. B's own timer must keep its cadence.
    await h.advance(5_000);
    await h.service.refresh(DIR_A, 'command');
    await h.advance(HOT);

    const bTimes = remoteTimesFor(h, DIR_B).map((at) => at - bStart);
    expect(bTimes).toEqual([0, HOT]);
  });

  it('uses the policy passed to createWorkspaceService', async () => {
    const h = setup({ probeIntervalMs: 500 });
    h.service.start();
    h.push(observedNow(DIR_A));
    await h.advance(0);

    // The tier-up remote poll reads the probe too, so count from the post-tier-up baseline.
    const baseline = h.probeReads.get(DIR_A) ?? 0;
    await h.advance(499);
    expect(h.probeReads.get(DIR_A) ?? 0).toBe(baseline);
    await h.advance(1);
    expect(h.probeReads.get(DIR_A) ?? 0).toBeGreaterThan(baseline);
  });
});
