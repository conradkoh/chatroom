import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueueModule from './remote-poll-queue.js';
import type * as MonitorModule from './workspace-monitor.js';
import {
  createWorkspaceService,
  type WorkspaceAgentPresenceSource,
  type WorkspaceService,
  type WorkspaceServiceDeps,
} from './workspace-service.js';
import type { AgentWorkspacePresence } from '../../agent-process-service/domain/entities/agent-process.js';
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
import type { ProbeSnapshot, WorkspaceGitProbe } from '../infrastructure/workspace-git-probe.js';
import type { WorkspaceMembershipSource } from '../infrastructure/workspace-membership-source.js';

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

/** One present agent in `workingDir`. The role only matters for counting agents in one directory. */
function agent(workingDir: string, role = 'builder'): AgentWorkspacePresence {
  return { chatroomId: 'chatroom-test', role, workingDir };
}

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

/** Sets the member directories. Throws when the service is not subscribed. */
function fakeMembership() {
  let onWorkingDirs: ((workingDirs: readonly string[]) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    stopOrder.push('unsubscribe');
    onWorkingDirs = null;
  });
  const source: WorkspaceMembershipSource = {
    subscribe: vi.fn((cb: (workingDirs: readonly string[]) => void) => {
      onWorkingDirs = cb;
      return unsubscribe;
    }),
  };
  return {
    source,
    unsubscribe,
    set(workingDirs: readonly string[]) {
      if (onWorkingDirs === null) throw new Error('membership source is not subscribed');
      onWorkingDirs(workingDirs);
    },
  };
}

/**
 * Sets the present agents and fires every subscriber, as the agent process manager does on each
 * transition. `list` is a spy so tests can count presence reads.
 */
function fakePresence() {
  let presences: AgentWorkspacePresence[] = [];
  let listFails = false;
  const subscribers = new Set<() => void>();
  const list = vi.fn((): readonly AgentWorkspacePresence[] => {
    if (listFails) throw new Error('presence read failed');
    return presences;
  });
  const source: WorkspaceAgentPresenceSource = {
    list,
    subscribe: vi.fn((onChange: () => void) => {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    }),
  };
  return {
    source,
    list,
    subscriberCount: () => subscribers.size,
    set(next: AgentWorkspacePresence[]) {
      presences = next;
      for (const onChange of [...subscribers]) onChange();
    },
    setListFails(value: boolean) {
      listFails = value;
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

  const membership = fakeMembership();
  const presence = fakePresence();
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
    membershipSource: membership.source,
    agentPresence: presence.source,
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
    membership,
    presence,
    outbox,
    createProbe,
    collectLocal,
    repoOf,
    probeReads,
    remoteCalls,
    /** Sets the member directories. Members with no present agent stay idle. */
    members: (...dirs: string[]) => membership.set(dirs),
    /** Replaces the present agents. */
    agents: (...entries: AgentWorkspacePresence[]) => presence.set(entries),
    /** Makes `dirs` the members, each with one present agent, so each one starts active. */
    activate: (...dirs: string[]) => {
      presence.set(dirs.map((dir) => agent(dir)));
      membership.set(dirs);
    },
    /** Advances fake time and lets the promise chains settle between timers. */
    advance: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

type Harness = ReturnType<typeof setup>;

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

  it('creates one monitor per member, and an idle member runs nothing', async () => {
    const h = setup();
    h.service.start();

    h.members(DIR_A, DIR_B);
    await h.advance(0);

    expect(h.service.isRegistered(DIR_A)).toBe(true);
    expect(h.service.isRegistered(DIR_B)).toBe(true);
    expect(h.createProbe).toHaveBeenCalledTimes(2);
    expect(h.collectLocal).not.toHaveBeenCalled();
    expect(h.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('emits head for each member that has a present agent', async () => {
    const h = setup();
    h.service.start();

    h.activate(DIR_A, DIR_B);
    await h.advance(0);

    for (const dir of [DIR_A, DIR_B]) {
      expect(enqueuedFor(h, dir).map((unit) => unit.kind)).toContain('head');
    }
  });

  it('a member with no present agent gets no probe reads, local recomputes, or remote polls', async () => {
    const h = setup();
    h.service.start();
    h.members(DIR_A);

    await h.advance(10 * PROBE);

    expect(h.service.isRegistered(DIR_A)).toBe(true);
    expect(h.probeReads.get(DIR_A)).toBeUndefined();
    expect(h.collectLocal).not.toHaveBeenCalled();
    expect(h.remoteCalls).toEqual([]);
    expect(h.outbox.enqueue).not.toHaveBeenCalled();

    // An explicit refresh still works on an idle member.
    await h.service.refresh(DIR_A, 'command');
    expect(h.collectLocal).toHaveBeenCalledWith(DIR_A, new Set(LOCAL_KINDS));
  });

  it('a present agent makes a member active with one full recompute and one remote poll', async () => {
    const h = setup();
    h.service.start();
    h.members(DIR_A);
    await h.advance(0);

    h.agents(agent(DIR_A));
    await h.advance(0);

    expect(h.collectLocal).toHaveBeenCalledTimes(1);
    expect(h.collectLocal).toHaveBeenCalledWith(DIR_A, new Set(LOCAL_KINDS));
    expect(remoteTimesFor(h, DIR_A)).toHaveLength(1);
  });

  it('the last agent leaving runs one final flush, then one remote poll that does not reschedule', async () => {
    const h = setup();
    h.service.start();
    h.activate(DIR_A);
    await h.advance(PROBE + 1_000);
    const recomputesWhileActive = h.collectLocal.mock.calls.length;
    const remoteWhileActive = remoteTimesFor(h, DIR_A).length;

    h.agents();
    await h.advance(0);

    expect(h.collectLocal.mock.calls.length - recomputesWhileActive).toBe(1);
    expect(h.collectLocal).toHaveBeenLastCalledWith(DIR_A, new Set(LOCAL_KINDS));
    await h.advance(MIN_GAP);
    expect(remoteTimesFor(h, DIR_A).length - remoteWhileActive).toBe(1);

    // Idle: no probe reads and no further remote polls, however long we wait.
    const readsAtIdle = h.probeReads.get(DIR_A) ?? 0;
    const remoteAtIdle = remoteTimesFor(h, DIR_A).length;
    await h.advance(10 * 60_000);
    expect(h.probeReads.get(DIR_A) ?? 0).toBe(readsAtIdle);
    expect(remoteTimesFor(h, DIR_A)).toHaveLength(remoteAtIdle);
  });

  it('an idle member becomes active again when an agent appears, with one full recompute', async () => {
    const h = setup();
    h.service.start();
    h.activate(DIR_A);
    await h.advance(PROBE);
    h.agents();
    await h.advance(0);
    const recomputesWhileIdle = h.collectLocal.mock.calls.length;
    const readsWhileIdle = h.probeReads.get(DIR_A) ?? 0;

    h.agents(agent(DIR_A));
    await h.advance(0);
    expect(h.collectLocal.mock.calls.length - recomputesWhileIdle).toBe(1);
    expect(h.collectLocal).toHaveBeenLastCalledWith(DIR_A, new Set(LOCAL_KINDS));
    await h.advance(PROBE);

    expect(h.probeReads.get(DIR_A) ?? 0).toBeGreaterThan(readsWhileIdle);
  });

  it('stops a removed directory: cancels its remote timer, drops its keys, and emits nothing later', async () => {
    const h = setup();
    h.service.start();
    h.activate(DIR_A, DIR_B);
    await h.advance(0);

    h.activate(DIR_B);
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
    h.activate(DIR_A);
    await h.advance(0);

    h.activate();
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
    h.activate(DIR_A);
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

  it('stopAll unsubscribes, leaves no timers pending, and ignores later membership', async () => {
    const h = setup();
    h.service.start();
    h.activate(DIR_A, DIR_B);
    await h.advance(PROBE + 1_000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await h.service.stopAll();

    expect(h.membership.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.presence.subscriberCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.service.isRegistered(DIR_A)).toBe(false);
    expect(() => h.members(DIR_A)).toThrow('not subscribed');
  });

  it('stopAll unsubscribes both sources, so later presence signals do nothing', async () => {
    const h = setup();
    h.service.start();
    h.activate(DIR_A);
    await h.advance(0);

    await h.service.stopAll();
    const readsBeforeSignal = h.presence.list.mock.calls.length;
    h.agents(agent(DIR_A));
    await h.advance(0);

    expect(h.presence.list.mock.calls.length).toBe(readsBeforeSignal);
    expect(h.collectLocal).toHaveBeenCalledTimes(1);
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
    h.activate(DIR_A, DIR_B);
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
    h.activate(DIR_A);
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

  it('start subscribes to membership and presence only once', () => {
    const h = setup();

    h.service.start();
    h.service.start();

    expect(h.membership.source.subscribe).toHaveBeenCalledTimes(1);
    expect(h.presence.source.subscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps one remote timer per workspace: refreshing A does not move B', async () => {
    const h = setup();
    h.service.start();
    h.activate(DIR_A, DIR_B);
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
    h.activate(DIR_A);
    await h.advance(0);

    // Activation's remote poll reads the probe too, so count from that baseline.
    const baseline = h.probeReads.get(DIR_A) ?? 0;
    await h.advance(499);
    expect(h.probeReads.get(DIR_A) ?? 0).toBe(baseline);
    await h.advance(1);
    expect(h.probeReads.get(DIR_A) ?? 0).toBeGreaterThan(baseline);
  });

  it('a present agent in a non-member directory creates no monitor, and a membership update activates it at once', async () => {
    const h = setup();
    h.service.start();
    h.agents(agent(DIR_A));
    await h.advance(0);

    expect(h.service.isRegistered(DIR_A)).toBe(false);
    expect(h.createProbe).not.toHaveBeenCalled();

    h.members(DIR_A);
    await h.advance(0);

    expect(h.service.isRegistered(DIR_A)).toBe(true);
    expect(h.collectLocal).toHaveBeenCalledWith(DIR_A, new Set(LOCAL_KINDS));
  });

  it('matches a present agent to a member when the agent reports a trailing slash', async () => {
    const h = setup();
    h.service.start();
    h.members(DIR_A);
    await h.advance(0);

    h.agents(agent(`${DIR_A}/`));
    await h.advance(0);

    expect(h.collectLocal).toHaveBeenCalledTimes(1);
    expect(h.collectLocal).toHaveBeenCalledWith(DIR_A, new Set(LOCAL_KINDS));
  });

  it('several presence signals in one tick cause one presence read', async () => {
    const h = setup();
    h.service.start();
    h.members(DIR_A);
    await h.advance(0);
    h.presence.list.mockClear();

    for (let i = 0; i < 5; i++) h.agents(agent(DIR_A));
    await h.advance(0);

    expect(h.presence.list).toHaveBeenCalledTimes(1);
  });

  it('a failing presence read is logged and leaves every member activity unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = setup();
    h.service.start();
    h.members(DIR_A);
    await h.advance(0);

    h.presence.setListFails(true);
    h.agents(agent(DIR_A));
    await h.advance(0);

    expect(warn).toHaveBeenCalledWith(
      '[workspace-service] agent presence read failed',
      expect.any(Error)
    );
    expect(h.collectLocal).not.toHaveBeenCalled();
    expect(h.service.isRegistered(DIR_A)).toBe(true);
  });

  it('two agents in one directory keep it active until the last one leaves', async () => {
    const h = setup();
    h.service.start();
    h.activate(DIR_A);
    await h.advance(0);
    const recomputesWhileActive = h.collectLocal.mock.calls.length;

    // One of two agents stops. The directory is still active, so nothing changes.
    h.agents(agent(DIR_A, 'builder'), agent(DIR_A, 'reviewer'));
    h.agents(agent(DIR_A, 'reviewer'));
    await h.advance(0);
    expect(h.collectLocal.mock.calls.length).toBe(recomputesWhileActive);
    expect(h.service.isRegistered(DIR_A)).toBe(true);

    // The last agent stops. The directory goes idle and runs its final flush.
    h.agents();
    await h.advance(0);
    expect(h.collectLocal.mock.calls.length - recomputesWhileActive).toBe(1);
  });
});
