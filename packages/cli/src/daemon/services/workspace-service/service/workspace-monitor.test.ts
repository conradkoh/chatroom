import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nextRemotePollDelayMs } from './remote-cadence.js';
import { createWorkspaceMonitor, type WorkspaceMonitor } from './workspace-monitor.js';
import { computeBackoff } from '../../../../infrastructure/services/workspace/git-workspace-change-source.js';
import type {
  GitBranchHeader,
  GitPorcelainEntry,
} from '../../../../infrastructure/services/workspace/git-workspace-porcelain.js';
import type { ObservationTier } from '../domain/observation-tier.js';
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
import type { ProbeSnapshot } from '../infrastructure/workspace-git-probe.js';

const WORKING_DIR = '/repo';
const { probeIntervalMs: PROBE, localSettleMs: SETTLE } = DEFAULT_WORKSPACE_SYNC_POLICY;
const TRIGGER = DEFAULT_WORKSPACE_SYNC_POLICY.remote.triggerSettleMs;
const LOCAL_KIND_SET: ReadonlySet<string> = new Set(LOCAL_KINDS);
const REMOTE_KINDS_SET: ReadonlySet<string> = new Set(['pullRequests', 'checks']);

type FakeRepo = {
  headAvailable: boolean;
  hasRemote: boolean;
  branch: GitBranchHeader;
  entries: GitPorcelainEntry[];
};

const OK_REMOTE: RemoteCollectResult = {
  ok: true,
  units: [
    { kind: 'pullRequests', openPullRequests: [] },
    { kind: 'checks', headCommitStatus: null },
  ],
  checksState: null,
};

function freshRepo(): FakeRepo {
  return {
    headAvailable: true,
    hasRemote: true,
    branch: { oid: 'a1', head: 'main', upstream: 'origin/main', ahead: 0, behind: 0 },
    entries: [],
  };
}

/** Local units derived from the fake repo. Each kind's value changes when its source field changes. */
function localResult(repo: FakeRepo, kinds: ReadonlySet<LocalKind>): LocalCollectResult {
  const oid = repo.branch.oid ?? '';
  const values: Record<Exclude<LocalKind, 'head'>, WorkspaceStateUnit> = {
    worktree: {
      kind: 'worktree',
      isDirty: repo.entries.length > 0,
      diffStat: { filesChanged: repo.entries.length, insertions: 0, deletions: 0 },
    },
    upstream: {
      kind: 'upstream',
      commitsAhead: repo.branch.ahead,
      commitsBehind: repo.branch.behind,
    },
    remotes: {
      kind: 'remotes',
      remotes: repo.hasRemote ? [{ name: 'origin', url: 'git@example.com:repo.git' }] : [],
    },
    recentCommits: {
      kind: 'recentCommits',
      commits: oid
        ? [{ sha: oid, shortSha: oid.slice(0, 7), message: 'm', author: 'a', date: 'd' }]
        : [],
      hasMoreCommits: false,
    },
    commands: { kind: 'commands', commands: [] },
  };
  const head: WorkspaceStateUnit = repo.headAvailable
    ? { kind: 'head', status: 'available', branch: repo.branch.head ?? '' }
    : { kind: 'head', status: 'not_found' };

  const units: WorkspaceStateUnit[] = [head];
  for (const kind of LOCAL_KINDS) {
    if (kind === 'head' || !kinds.has(kind)) continue;
    // A non-git directory only reports `commands`, matching the real collector.
    if (!repo.headAvailable && kind !== 'commands') continue;
    units.push(values[kind]);
  }
  return {
    units,
    headAvailable: repo.headAvailable,
    branch: repo.headAvailable ? repo.branch.head : null,
    hasRemote: repo.headAvailable && repo.hasRemote,
  };
}

function snapshotOf(repo: FakeRepo): ProbeSnapshot {
  return {
    branch: { ...repo.branch },
    entries: repo.entries.map((entry) => ({ ...entry })),
    dirtyStats: new Map(),
    statCapped: false,
    readAt: Date.now(),
  };
}

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Builds a monitor over a fake repo. The remote queue is modelled as one fake timer per
 * workspace, which is what the real queue does for a single workspace.
 */
function setup(overrides: DeepPartial<WorkspaceSyncPolicy> = {}) {
  const policy = resolveWorkspaceSyncPolicy(overrides);
  const repo = freshRepo();
  let probeFails = false;
  const readTimes: number[] = [];
  let remoteTimer: ReturnType<typeof setTimeout> | null = null;

  const probe = {
    workTree: WORKING_DIR,
    rootPathspec: [],
    readSnapshot: vi.fn(async (_opts: { maxAgeMs: number }): Promise<ProbeSnapshot> => {
      readTimes.push(Date.now());
      if (probeFails) throw new Error('probe read failed');
      return snapshotOf(repo);
    }),
  };
  const collectLocal = vi.fn(
    async (_workingDir: string, kinds: ReadonlySet<LocalKind>): Promise<LocalCollectResult> =>
      localResult(repo, kinds)
  );
  const collectRemote = vi.fn(
    async (_workingDir: string, _branch: string): Promise<RemoteCollectResult> => OK_REMOTE
  );
  const enqueue = vi.fn<(unit: WorkspaceStateUnit) => void>();
  const cancelRemoteTimer = (): void => {
    if (remoteTimer !== null) clearTimeout(remoteTimer);
    remoteTimer = null;
  };
  const scheduleRemote = vi.fn((delayMs: number) => {
    cancelRemoteTimer();
    remoteTimer = setTimeout(() => {
      remoteTimer = null;
      void monitor.runRemotePoll();
    }, delayMs);
  });
  const cancelRemote = vi.fn(cancelRemoteTimer);

  const monitor: WorkspaceMonitor = createWorkspaceMonitor({
    workingDir: WORKING_DIR,
    policy,
    now: () => Date.now(),
    probe,
    collectLocal,
    collectRemote,
    enqueue,
    scheduleRemote,
    cancelRemote,
  });

  return {
    monitor,
    policy,
    repo,
    probe,
    readTimes,
    collectLocal,
    collectRemote,
    enqueue,
    scheduleRemote,
    cancelRemote,
    setProbeFails(value: boolean) {
      probeFails = value;
    },
    /** Advances fake time and flushes the promise chain between timers. */
    advance(ms: number) {
      return vi.advanceTimersByTimeAsync(ms).then(() => undefined);
    },
    setTier(tier: ObservationTier) {
      monitor.setTier(tier);
    },
  };
}

type Harness = ReturnType<typeof setup>;

/** Kinds of every unit enqueued since the last clear, in order. */
function enqueuedKinds(h: Harness): string[] {
  return h.enqueue.mock.calls.map(([unit]) => unit.kind);
}

function localKindsEnqueued(h: Harness): string[] {
  return enqueuedKinds(h).filter((kind) => LOCAL_KIND_SET.has(kind));
}

function remoteKindsEnqueued(h: Harness): string[] {
  return enqueuedKinds(h).filter((kind) => REMOTE_KINDS_SET.has(kind));
}

describe('createWorkspaceMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('makes no probe reads, local recomputes, or remote calls while idle', async () => {
    const h = setup();

    await h.advance(10 * 60_000);

    expect(h.probe.readSnapshot).not.toHaveBeenCalled();
    expect(h.collectLocal).not.toHaveBeenCalled();
    expect(h.collectRemote).not.toHaveBeenCalled();
    expect(h.scheduleRemote).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('runs one full local recompute on tier-up and emits every local unit', async () => {
    const h = setup();

    h.setTier('observed');
    await h.advance(0);

    expect(h.collectLocal).toHaveBeenCalledTimes(1);
    expect(h.collectLocal.mock.calls[0][1]).toEqual(new Set(LOCAL_KINDS));
    expect(localKindsEnqueued(h)).toEqual([...LOCAL_KINDS]);
  });

  it('emits nothing when a later recompute finds no changed unit', async () => {
    const h = setup();
    h.setTier('observed');
    await h.advance(0);
    const emittedOnTierUp = h.enqueue.mock.calls.length;

    // The first probe tick requests every kind as a baseline. The recompute finds no change.
    await h.advance(PROBE + SETTLE);

    expect(h.collectLocal).toHaveBeenCalledTimes(2);
    expect(h.enqueue).toHaveBeenCalledTimes(emittedOnTierUp);
  });

  it('enqueues only worktree for a worktree-only change and skips remote', async () => {
    const h = setup();
    h.setTier('observed');
    await h.advance(PROBE + SETTLE); // baseline tick and its recompute
    h.enqueue.mockClear();
    h.collectRemote.mockClear();

    h.repo.entries = [{ xy: ' M', path: 'a.ts' }];
    await h.advance(PROBE + SETTLE);

    expect(enqueuedKinds(h)).toEqual(['worktree']);
    expect(h.collectLocal).toHaveBeenLastCalledWith(WORKING_DIR, new Set(['worktree']));
    expect(h.collectRemote).not.toHaveBeenCalled();
  });

  it('emits local kinds and polls remote after triggerSettleMs on a head move', async () => {
    const h = setup();
    h.setTier('observed');
    await h.advance(PROBE + SETTLE); // baseline tick and its recompute
    h.enqueue.mockClear();
    h.collectRemote.mockClear();
    h.collectLocal.mockClear();

    h.repo.branch = { ...h.repo.branch, oid: 'b2' };
    // The probe tick sees the head move and requests every local kind.
    await h.advance(PROBE);

    expect(h.collectLocal.mock.calls[0][1]).toEqual(new Set(LOCAL_KINDS));
    await h.advance(SETTLE);
    expect(localKindsEnqueued(h)).toContain('recentCommits');
    expect(h.collectRemote).not.toHaveBeenCalled();

    await h.advance(TRIGGER);
    expect(h.collectRemote).toHaveBeenCalledTimes(1);
    expect(h.collectRemote).toHaveBeenCalledWith(WORKING_DIR, 'main');
  });

  it('discards a remote result whose HEAD moved mid-poll and retries at once', async () => {
    const h = setup();
    const gate = deferred<RemoteCollectResult>();
    h.collectRemote.mockImplementationOnce(() => gate.promise);
    h.setTier('observed');
    await h.advance(0);
    expect(h.collectRemote).toHaveBeenCalledTimes(1);
    h.enqueue.mockClear();

    h.repo.branch = { ...h.repo.branch, oid: 'b2' };
    // Hold any follow-up poll so only the stale result's behaviour is observed.
    h.collectRemote.mockImplementation(() => new Promise<RemoteCollectResult>(() => {}));
    gate.resolve({
      ok: true,
      units: [
        {
          kind: 'pullRequests',
          openPullRequests: [
            { prNumber: 99, title: 'stale', url: 'u', headRefName: 'main', state: 'OPEN' },
          ],
        },
        { kind: 'checks', headCommitStatus: null },
      ],
      checksState: null,
    });
    await h.advance(0);

    expect(remoteKindsEnqueued(h)).toEqual([]);
    expect(h.scheduleRemote).toHaveBeenLastCalledWith(0);
  });

  it('keeps last-known values on a failed remote read and backs off by nextRemotePollDelayMs', async () => {
    const h = setup();
    h.collectRemote.mockResolvedValue({ ok: false, error: 'gh unavailable' });
    h.setTier('observed');
    await h.advance(0);

    expect(remoteKindsEnqueued(h)).toEqual([]);
    const firstDelay = nextRemotePollDelayMs({
      now: Date.now(),
      lastTriggerAt: null,
      checksState: null,
      consecutiveFailures: 1,
      policy: h.policy.remote,
    });
    expect(h.scheduleRemote).toHaveBeenLastCalledWith(firstDelay);

    await h.advance(firstDelay);
    expect(h.collectRemote).toHaveBeenCalledTimes(2);
    expect(remoteKindsEnqueued(h)).toEqual([]);
    const secondDelay = nextRemotePollDelayMs({
      now: Date.now(),
      lastTriggerAt: null,
      checksState: null,
      consecutiveFailures: 2,
      policy: h.policy.remote,
    });
    expect(h.scheduleRemote).toHaveBeenLastCalledWith(secondDelay);
    expect(secondDelay).toBeGreaterThan(firstDelay);
  });

  it.each<[string, (repo: FakeRepo) => void]>([
    [
      'no remote',
      (repo) => {
        repo.hasRemote = false;
      },
    ],
    [
      'detached HEAD',
      (repo) => {
        repo.branch = { ...repo.branch, head: 'HEAD' };
      },
    ],
  ])('publishes empty remote units and never polls when %s', async (_name, mutate) => {
    const h = setup();
    mutate(h.repo);

    h.setTier('observed');
    await h.advance(0);

    expect(h.collectRemote).not.toHaveBeenCalled();
    expect(h.enqueue).toHaveBeenCalledWith({ kind: 'pullRequests', openPullRequests: [] });
    expect(h.enqueue).toHaveBeenCalledWith({ kind: 'checks', headCommitStatus: null });
  });

  it('stops probe reads and cancels remote work on observed to idle', async () => {
    const h = setup();
    h.setTier('observed');
    await h.advance(PROBE + SETTLE);
    const readsBeforeIdle = h.probe.readSnapshot.mock.calls.length;
    const remoteBeforeIdle = h.collectRemote.mock.calls.length;

    h.setTier('idle');
    expect(h.cancelRemote).toHaveBeenCalled();
    h.repo.entries = [{ xy: ' M', path: 'a.ts' }];
    await h.advance(60_000);

    expect(h.probe.readSnapshot).toHaveBeenCalledTimes(readsBeforeIdle);
    expect(h.collectRemote).toHaveBeenCalledTimes(remoteBeforeIdle);
  });

  it('runs an already-queued remote poll once in idle without rescheduling', async () => {
    const h = setup();
    h.setTier('observed');
    await h.advance(0);
    h.setTier('idle');
    h.scheduleRemote.mockClear();

    await h.monitor.runRemotePoll();

    expect(h.collectRemote).toHaveBeenCalledTimes(2);
    expect(h.scheduleRemote).not.toHaveBeenCalled();
  });

  it('refresh re-emits units that were already sent', async () => {
    const h = setup();
    h.setTier('observed');
    await h.advance(0);
    h.enqueue.mockClear();

    await h.monitor.refresh();

    expect(localKindsEnqueued(h)).toEqual([...LOCAL_KINDS]);
  });

  it('refresh works while idle and schedules one remote poll without starting the probe', async () => {
    const h = setup();

    await h.monitor.refresh();

    expect(h.collectLocal).toHaveBeenCalledTimes(1);
    expect(h.scheduleRemote).toHaveBeenLastCalledWith(0);
    expect(h.probe.readSnapshot).not.toHaveBeenCalled();
  });

  it('retries failed probe reads with backoff and runs one head recompute at the threshold', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = setup();
    h.setTier('observed');
    await h.advance(0);
    h.collectLocal.mockClear();
    h.readTimes.length = 0; // drop the remote eligibility read from tier-up
    h.setProbeFails(true);

    // Failures at 3s, 6s and 12s. The third one reaches the threshold.
    await h.advance(12_000);

    expect(h.readTimes).toEqual([PROBE, PROBE * 2, PROBE * 4]);
    const headOnly = h.collectLocal.mock.calls.filter(
      ([, kinds]) => kinds.size === 1 && kinds.has('head')
    );
    expect(headOnly).toHaveLength(1);
    warn.mockRestore();
  });

  it('spaces probe retries by computeBackoff, capped at probeMaxBackoffMs', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Keep remote polls out of the window: a failing probe would also fail their eligibility read.
    const h = setup({ probeMaxBackoffMs: 8_000, remote: { hotIntervalMs: 600_000 } });
    h.setTier('observed');
    await h.advance(0);
    h.readTimes.length = 0;
    h.setProbeFails(true);

    // Reads at 3s, 6s, 12s and 20s. The gap after the third failure is capped at 8s.
    await h.advance(20_000);

    const gaps = h.readTimes.slice(1).map((time, i) => time - h.readTimes[i]);
    expect(gaps).toEqual([
      computeBackoff(1, PROBE, 8_000),
      computeBackoff(2, PROBE, 8_000),
      computeBackoff(3, PROBE, 8_000),
    ]);
    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(8_000);
    warn.mockRestore();
  });

  it('starts no probe loop for a non-git directory', async () => {
    const h = setup();
    h.repo.headAvailable = false;
    h.repo.hasRemote = false;

    h.setTier('observed');
    await h.advance(PROBE * 5);

    expect(h.probe.readSnapshot).not.toHaveBeenCalled();
    expect(h.collectLocal).toHaveBeenCalledTimes(1);
  });

  it('stop waits for an in-flight recompute and then leaves no timers', async () => {
    const h = setup();
    const gate = deferred<LocalCollectResult>();
    h.collectLocal.mockImplementationOnce(() => gate.promise);
    h.setTier('observed');
    await h.advance(0);

    let stopped = false;
    const stopping = h.monitor.stop().then(() => {
      stopped = true;
    });
    await h.advance(0);
    expect(stopped).toBe(false);

    gate.resolve(localResult(h.repo, new Set(LOCAL_KINDS)));
    await stopping;
    expect(stopped).toBe(true);
    expect(localKindsEnqueued(h)).toEqual([...LOCAL_KINDS]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop clears the probe loop and remote timers', async () => {
    const h = setup();
    h.setTier('observed');
    await h.advance(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await h.monitor.stop();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats calls after stop as no-ops', async () => {
    const h = setup();
    await h.monitor.stop();
    h.collectLocal.mockClear();

    h.setTier('observed');
    await h.monitor.refresh();
    await h.monitor.runRemotePoll();

    expect(h.collectLocal).not.toHaveBeenCalled();
    expect(h.collectRemote).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
