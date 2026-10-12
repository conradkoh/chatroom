/**
 * End-to-end test of the wired WorkspaceService against a real git repository.
 *
 * Real: git (temp repo with a bare origin), the git probe, the local and remote collectors, the
 * monitor, the service, and the durable workspace-state outbox (SQLite under a temp HOME). The
 * dead-agent scenario also uses a real AgentProcessManager as the presence source.
 * Faked: the backend mutation (records calls and can be made to fail), the registered-directory
 * membership, and agent presence, which the tests control. The GitHub readers are stubbed because
 * they need `gh`. The agent harness and the process kill are fakes, as in the manager's unit tests.
 *
 * Run with: vitest run --config vitest.integration.config.ts
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AgentStartReasonCode } from '@workspace/backend/src/domain/entities/agent.js';
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceService,
  type WorkspaceAgentPresenceSource,
  type WorkspaceService,
} from './workspace-service.js';
import { api } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import type { SessionId } from '../../../entry/daemon-types.js';
import {
  createWorkspaceStateOutboxRegistry,
  createWorkspaceStateSend,
  encodeWorkspaceStateKey,
  WORKSPACE_STATE_KINDS,
  type WorkspaceStateOutboxRegistry,
} from '../../../infrastructure/outbox/index.js';
import type { WorkspaceStateKind } from '../../../infrastructure/outbox/workspace-state-outbox.js';
import type { AgentWorkspacePresence } from '../../agent-process-service/domain/entities/agent-process.js';
import {
  AgentProcessManager,
  type AgentProcessManagerDeps,
  type EnsureRunningOpts,
} from '../../agent-process-service/infrastructure/agent-process-manager.js';
import type { WorkspaceStateUnit } from '../domain/workspace-state-unit.js';
import {
  resolveWorkspaceSyncPolicy,
  type WorkspaceSyncPolicy,
} from '../domain/workspace-sync-policy.js';
import type { WorkspaceMembershipSource } from '../infrastructure/workspace-membership-source.js';

// The GitHub readers shell out to `gh`. Stub only those two; the git readers stay real.
vi.mock('../../../infrastructure/git/git-reader.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readOpenPRsForBranch: vi.fn(async () => ({ ok: true, value: [] })),
  readCommitStatusChecks: vi.fn(async () => ({ ok: true, value: null })),
}));

const execFileAsync = promisify(execFile);
const MACHINE_ID = 'machine-integration';
const SESSION_ID = 'session-integration' as SessionId;
const CHATROOM_ID = 'chatroom-integration';
/** The pid the first fake agent process gets. Later spawns get the following pids. */
const FIRST_AGENT_PID = 42;

/** Probe, settle, and outbox windows short enough for a fast end-to-end run. */
const POLICY: WorkspaceSyncPolicy = resolveWorkspaceSyncPolicy({
  probeIntervalMs: 50,
  localSettleMs: 20,
  outbox: {
    minIntervalMsByKind: Object.fromEntries(
      WORKSPACE_STATE_KINDS.map((kind) => [kind, 0])
    ) as Record<WorkspaceStateKind, number>,
    retryDelayMs: 10,
    maxRetryDelayMs: 50,
  },
});

/**
 * One backend mutation. `name` is the Convex function name (for example `workspaces:patchWorkspaceGitState`),
 * because the generated `api` object builds a new reference on every property access.
 */
type MutationCall = { name: string; args: Record<string, unknown> };

const PATCH_UNIT = getFunctionName(api.workspaces.patchWorkspaceGitState);
const UPSERT_RECENT_COMMITS = getFunctionName(api.workspaces.upsertRecentCommits);
const SYNC_COMMANDS = getFunctionName(api.commands.syncCommands);

function nameOf(fn: unknown): string {
  return getFunctionName(fn as Parameters<typeof getFunctionName>[0]);
}

/** Backend fake. `failing` makes patchWorkspaceGitState calls for the chosen kind reject. */
type FakeBackend = {
  backend: BackendOps;
  calls: MutationCall[];
  failKind: { kind: WorkspaceStateKind | null };
};

function createFakeBackend(): FakeBackend {
  const calls: MutationCall[] = [];
  const failKind: { kind: WorkspaceStateKind | null } = { kind: null };
  const mutation = vi.fn(async (fn: unknown, args: Record<string, unknown>) => {
    const name = nameOf(fn);
    calls.push({ name, args });
    if (name === PATCH_UNIT) {
      const unit = args.unit as WorkspaceStateUnit;
      if (failKind.kind !== null && unit.kind === failKind.kind) {
        throw new Error('backend unavailable');
      }
      return { applied: true };
    }
    return undefined;
  });
  return {
    backend: { mutation, query: vi.fn() } as unknown as BackendOps,
    calls,
    failKind,
  };
}

/** Registered directories the test controls. The service subscribes once; `set` fires its callback. */
type FakeMembership = {
  source: WorkspaceMembershipSource;
  set(workingDirs: readonly string[]): void;
};

/** Calls back with the initial directories on subscribe, as the Convex subscription does. */
function fakeMembership(initial: readonly string[]): FakeMembership {
  let current = initial;
  let onChange: ((workingDirs: readonly string[]) => void) | null = null;
  return {
    source: {
      subscribe(callback) {
        onChange = callback;
        callback(current);
        return () => {
          onChange = null;
        };
      },
    },
    set(workingDirs) {
      current = workingDirs;
      onChange?.(workingDirs);
    },
  };
}

/** Agent presence the test controls. `set` replaces the snapshot and fires subscribers, as the manager does. */
type FakePresence = {
  source: WorkspaceAgentPresenceSource;
  set(presences: readonly AgentWorkspacePresence[]): void;
};

function fakePresence(initial: readonly AgentWorkspacePresence[]): FakePresence {
  let current = initial;
  const subscribers = new Set<() => void>();
  return {
    source: {
      list: () => current,
      subscribe(onChange) {
        subscribers.add(onChange);
        return () => {
          subscribers.delete(onChange);
        };
      },
    },
    set(presences) {
      current = presences;
      for (const onChange of [...subscribers]) onChange();
    },
  };
}

/** One present builder agent in `workingDir`. */
function agentIn(workingDir: string, role = 'builder'): AgentWorkspacePresence {
  return { chatroomId: CHATROOM_ID, role, workingDir };
}

type Harness = {
  service: WorkspaceService;
  registry: WorkspaceStateOutboxRegistry;
  fake: FakeBackend;
  membership: FakeMembership;
  presence: FakePresence;
};

type StartOptions = {
  /** Registered directories at start. Default: the repository, which the existing tests start from. */
  members?: string[];
  /** Present agents at start. Default: one builder in the repository, so it starts active. */
  agents?: AgentWorkspacePresence[];
  /** A real presence source to use instead of the controllable one. */
  presenceSource?: WorkspaceAgentPresenceSource;
};

/** Starts the real service and durable outbox on top of `fake`. */
function startHarness(workingDir: string, fake: FakeBackend, options: StartOptions = {}): Harness {
  const membership = fakeMembership(options.members ?? [workingDir]);
  const presence = fakePresence(options.agents ?? [agentIn(workingDir)]);
  const registry = createWorkspaceStateOutboxRegistry(
    MACHINE_ID,
    createWorkspaceStateSend({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      backend: fake.backend,
    }),
    {
      minIntervalMsByKind: POLICY.outbox.minIntervalMsByKind,
      retryDelayMs: POLICY.outbox.retryDelayMs,
      maxRetryDelayMs: POLICY.outbox.maxRetryDelayMs,
    }
  );
  const service = createWorkspaceService({
    membershipSource: membership.source,
    agentPresence: options.presenceSource ?? presence.source,
    outbox: {
      enqueue: (dir, unit) => {
        registry.enqueue(encodeWorkspaceStateKey(dir, unit.kind), unit).catch(() => undefined);
      },
      stopKeys: (dir) => {
        for (const kind of WORKSPACE_STATE_KINDS) {
          registry.stop(encodeWorkspaceStateKey(dir, kind)).catch(() => undefined);
        }
      },
    },
    policy: POLICY,
    sessionId: SESSION_ID,
    machineId: MACHINE_ID,
    backend: fake.backend,
  });
  service.start();
  return { service, registry, fake, membership, presence };
}

/**
 * A real AgentProcessManager with fake spawn and kill, configured as in its unit tests. Killing a
 * pid through `markDead` makes the manager's liveness check see it as gone.
 */
function createAgentProcessFixture() {
  const deadPids = new Set<number>();
  let nextPid = FIRST_AGENT_PID;
  const kill = vi.fn((pid: number, signal?: number | string) => {
    if (signal === 0) {
      if (deadPids.has(pid)) throw new Error('ESRCH');
      return;
    }
    if (signal === 'SIGTERM' || signal === 'SIGKILL') deadPids.add(pid);
  });
  const harness = {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    isInstalled: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue({ version: '1.0.0', major: 1 }),
    listModels: vi.fn().mockResolvedValue([]),
    spawn: vi.fn(async () => {
      const pid = nextPid;
      nextPid += 1;
      return { pid, onExit: vi.fn(), onOutput: vi.fn(), onAgentEnd: vi.fn() };
    }),
    stop: vi.fn(async (pid: number) => {
      deadPids.add(pid);
    }),
    isAlive: vi.fn().mockReturnValue(false),
    getTrackedProcesses: vi.fn().mockReturnValue([]),
    untrack: vi.fn(),
  };
  const deps = {
    logEvent: vi.fn().mockResolvedValue(undefined),
    agentServices: new Map([['opencode', harness]]),
    backend: {
      query: vi.fn().mockResolvedValue({
        prompt: true,
        rolePrompt: 'You are a builder',
        initialMessage: 'Start working',
      }),
      mutation: vi.fn(async (_endpoint: unknown, args?: Record<string, unknown>) =>
        args &&
        'sessionId' in args &&
        'machineId' in args &&
        'chatroomId' in args &&
        'role' in args &&
        !('action' in args) &&
        !('pid' in args) &&
        !('fact' in args)
          ? { allowed: true }
          : {}
      ),
    },
    lifecycleOutbox: { enqueue: vi.fn().mockResolvedValue({ success: true }) },
    sessionId: 'test-session',
    machineId: MACHINE_ID,
    processes: { kill },
    clock: { delay: vi.fn().mockResolvedValue(undefined), now: () => Date.now() },
    fs: { stat: vi.fn().mockResolvedValue({ isDirectory: () => true }) },
    persistence: {
      persistAgentPid: vi.fn(),
      clearAgentPid: vi.fn(),
      listAgentEntries: vi.fn().mockResolvedValue([]),
    },
    spawning: { shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }) },
    convexUrl: 'http://test:3210',
  } as unknown as AgentProcessManagerDeps;
  return {
    manager: new AgentProcessManager(deps),
    markDead: (pid: number) => {
      deadPids.add(pid);
    },
  };
}

/** The manager's presence, as the service consumes it in production. */
function managerPresence(manager: AgentProcessManager): WorkspaceAgentPresenceSource {
  return {
    list: () => manager.listWorkspacePresences(),
    subscribe: (onChange) => manager.subscribeAgentPresenceChanged(onChange),
  };
}

/** Start options for a builder or reviewer in `workingDir`, as the daemon issues them. */
function agentStart(workingDir: string, role: string, chatroomId = CHATROOM_ID): EnsureRunningOpts {
  return {
    chatroomId,
    role,
    agentHarness: 'opencode',
    model: 'gpt-4',
    workingDir,
    reason: AgentStartReasonCode.USER_START,
    wantResume: true,
  };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.com',
      ...args,
    ],
    { cwd }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

/** The unit of every `patchWorkspaceGitState` call, in call order. */
function patchUnits(calls: readonly MutationCall[]): WorkspaceStateUnit[] {
  return calls
    .filter((call) => call.name === PATCH_UNIT)
    .map((call) => call.args.unit as WorkspaceStateUnit);
}

function worktreeUnits(calls: readonly MutationCall[]) {
  return patchUnits(calls).filter(
    (unit): unit is Extract<WorkspaceStateUnit, { kind: 'worktree' }> => unit.kind === 'worktree'
  );
}

/** The only backend mutations a git change may cause. Anything else means a handoff-style path ran. */
const CHANGE_DRIVEN_CALLS: ReadonlySet<string> = new Set([
  PATCH_UNIT,
  UPSERT_RECENT_COMMITS,
  SYNC_COMMANDS,
]);

function expectOnlyChangeDrivenCalls(calls: readonly MutationCall[]): void {
  const unexpected = calls
    .map((call) => call.name)
    .filter((name) => !CHANGE_DRIVEN_CALLS.has(name));
  expect(unexpected).toEqual([]);
}

describe('WorkspaceService end-to-end (real git, real outbox)', () => {
  let tmp: string;
  let home: string;
  let repo: string;
  let originalHome: string | undefined;
  const open: Harness[] = [];

  /** Starts a harness and tracks it so afterEach can stop it even when a test fails. */
  function start(fake: FakeBackend, options?: StartOptions): Harness {
    const harness = startHarness(repo, fake, options);
    open.push(harness);
    return harness;
  }

  /** Overwrites the tracked README. */
  function editReadme(content: string): Promise<void> {
    return writeFile(join(repo, 'README.md'), content);
  }

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workspace-service-int-'));
    home = join(tmp, 'home');
    repo = join(tmp, 'repo');
    const remote = join(tmp, 'remote.git');
    await mkdir(home, { recursive: true });
    await mkdir(repo, { recursive: true });

    originalHome = process.env.HOME;
    process.env.HOME = home;

    await execFileAsync('git', ['init', '-q', '--bare', remote]);
    await execFileAsync('git', ['init', '-q', '-b', 'main', repo]);
    await writeFile(join(repo, 'README.md'), 'init\n');
    await git(repo, ['add', 'README.md']);
    await git(repo, ['commit', '-q', '-m', 'init']);
    await git(repo, ['remote', 'add', 'origin', remote]);
    await git(repo, ['push', '-q', '-u', 'origin', 'main']);
  });

  afterEach(async () => {
    for (const harness of open.splice(0)) {
      await harness.service.stopAll();
      await harness.registry.stopAll();
    }
    process.env.HOME = originalHome;
    await rm(tmp, { recursive: true, force: true });
  });

  it('sends each unit once for the initial snapshot, head first', async () => {
    const fake = createFakeBackend();
    start(fake);

    const expectedKinds = ['head', 'worktree', 'upstream', 'remotes', 'pullRequests', 'checks'];
    await waitFor(
      () =>
        patchUnits(fake.calls).length >= expectedKinds.length &&
        worktreeUnits(fake.calls).length > 0,
      'initial git units'
    );
    await waitFor(() => fake.calls.some((c) => c.name === SYNC_COMMANDS), 'commands');
    await waitFor(() => fake.calls.some((c) => c.name === UPSERT_RECENT_COMMITS), 'recent commits');
    await sleep(POLICY.probeIntervalMs * 3);

    const kinds = patchUnits(fake.calls).map((unit) => unit.kind);
    expect(kinds[0]).toBe('head');
    expect([...kinds].sort()).toEqual([...expectedKinds].sort());
    expect(fake.calls.filter((c) => c.name === SYNC_COMMANDS)).toHaveLength(1);
    expect(fake.calls.filter((c) => c.name === UPSERT_RECENT_COMMITS)).toHaveLength(1);
  });

  it('sends only a head unit when the branch is switched on the same commit', async () => {
    const fake = createFakeBackend();
    start(fake);
    await waitFor(() => patchUnits(fake.calls).some((u) => u.kind === 'checks'), 'initial sync');
    await sleep(POLICY.probeIntervalMs * 3);

    const mark = fake.calls.length;
    await git(repo, ['checkout', '-q', '-b', 'feat']);
    await waitFor(
      () =>
        patchUnits(fake.calls.slice(mark)).some(
          (u) => u.kind === 'head' && u.status === 'available' && u.branch === 'feat'
        ),
      'head unit for feat'
    );

    const afterSwitch = patchUnits(fake.calls.slice(mark));
    expect(afterSwitch.some((u) => u.kind === 'worktree')).toBe(false);
    expect(afterSwitch.some((u) => u.kind === 'remotes')).toBe(false);
  });

  it('sends a worktree unit for an edit, and a new diffStat when the same file changes size', async () => {
    const fake = createFakeBackend();
    start(fake);
    await waitFor(() => worktreeUnits(fake.calls).length > 0, 'initial worktree unit');
    const initialCount = worktreeUnits(fake.calls).length;

    await writeFile(join(repo, 'README.md'), 'hello\n');
    await waitFor(
      () => worktreeUnits(fake.calls).length > initialCount,
      'worktree unit after first edit'
    );
    const first = worktreeUnits(fake.calls).at(-1);
    expect(first?.isDirty).toBe(true);

    await writeFile(join(repo, 'README.md'), 'hello\nworld\nmore\n');
    await waitFor(
      () => worktreeUnits(fake.calls).length > initialCount + 1,
      'worktree unit after second edit'
    );
    const second = worktreeUnits(fake.calls).at(-1);
    expect(second?.isDirty).toBe(true);
    expect(second?.diffStat).not.toEqual(first?.diffStat);
    expect(second?.diffStat.insertions).toBe(3);
  });

  it('sends nothing for ten probe ticks with no change', async () => {
    const fake = createFakeBackend();
    start(fake);
    await waitFor(() => patchUnits(fake.calls).some((u) => u.kind === 'checks'), 'initial sync');
    await sleep(POLICY.probeIntervalMs * 3);

    const mark = fake.calls.length;
    await sleep(POLICY.probeIntervalMs * 10);

    expect(fake.calls.length).toBe(mark);
  });

  it('retries a failing unit and delivers only the latest state once the backend recovers', async () => {
    const fake = createFakeBackend();
    start(fake);
    await waitFor(() => worktreeUnits(fake.calls).length > 0, 'initial worktree unit');
    await sleep(POLICY.probeIntervalMs * 3);

    fake.failKind.kind = 'worktree';
    const mark = fake.calls.length;
    await writeFile(join(repo, 'README.md'), 'hello\n');
    await waitFor(
      () => worktreeUnits(fake.calls.slice(mark)).length >= 2,
      'retried worktree attempts while failing'
    );

    await writeFile(join(repo, 'README.md'), 'hello\nworld\nmore\n');
    await waitFor(
      () => worktreeUnits(fake.calls.slice(mark)).some((u) => u.diffStat.insertions === 3),
      'latest worktree attempt while failing'
    );

    const recoverFrom = fake.calls.length;
    fake.failKind.kind = null;
    await waitFor(
      () => worktreeUnits(fake.calls.slice(recoverFrom)).length > 0,
      'worktree delivery after recovery'
    );
    await sleep(POLICY.probeIntervalMs * 5);

    const delivered = worktreeUnits(fake.calls.slice(recoverFrom));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.diffStat.insertions).toBe(3);
  });

  it('recovers a pending unit after a restart with the same HOME and sends it', async () => {
    const fake = createFakeBackend();
    const first = start(fake);
    await waitFor(() => worktreeUnits(fake.calls).length > 0, 'initial worktree unit');
    await sleep(POLICY.probeIntervalMs * 3);

    fake.failKind.kind = 'worktree';
    const mark = fake.calls.length;
    await writeFile(join(repo, 'README.md'), 'hello\nworld\n');
    await waitFor(
      () => worktreeUnits(fake.calls.slice(mark)).length > 0,
      'failing worktree attempt'
    );

    await first.service.stopAll();
    await first.registry.stopAll();
    open.splice(open.indexOf(first), 1);

    const restarted = createFakeBackend();
    start(restarted);
    await waitFor(
      () => worktreeUnits(restarted.calls).some((u) => u.diffStat.insertions === 2),
      'recovered worktree unit'
    );

    const recovered = worktreeUnits(restarted.calls).find((u) => u.diffStat.insertions === 2);
    expect(recovered?.isDirty).toBe(true);
  });

  it('emits a head unit for a new branch within 5s, with no handoff call', async () => {
    const fake = createFakeBackend();
    start(fake);
    await waitFor(() => patchUnits(fake.calls).some((u) => u.kind === 'checks'), 'initial sync');
    await sleep(POLICY.probeIntervalMs * 3);

    const mark = fake.calls.length;
    const startedAt = Date.now();
    await git(repo, ['checkout', '-q', '-b', 'x']);
    await waitFor(
      () =>
        patchUnits(fake.calls.slice(mark)).some(
          (u) => u.kind === 'head' && u.status === 'available' && u.branch === 'x'
        ),
      'head unit for branch x',
      5_000
    );

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expectOnlyChangeDrivenCalls(fake.calls);
  });

  it('emits a worktree unit with the new diffStat after a tracked edit, with no handoff call', async () => {
    const fake = createFakeBackend();
    start(fake);
    await waitFor(() => worktreeUnits(fake.calls).length > 0, 'initial worktree unit');

    const mark = fake.calls.length;
    await writeFile(join(repo, 'README.md'), 'hello\nworld\n');
    await waitFor(
      () =>
        worktreeUnits(fake.calls.slice(mark)).some(
          (u) => u.isDirty && u.diffStat.insertions === 2 && u.diffStat.deletions === 1
        ),
      'worktree unit with diffStat +2 -1'
    );

    expectOnlyChangeDrivenCalls(fake.calls);
  });

  it('emits an upstream unit when a push clears the ahead count, then sends nothing on unchanged refreshes', async () => {
    const fake = createFakeBackend();
    start(fake);
    await waitFor(() => patchUnits(fake.calls).some((u) => u.kind === 'checks'), 'initial sync');
    await git(repo, ['checkout', '-q', '-b', 'x']);
    await git(repo, ['push', '-q', '-u', 'origin', 'x']);
    await sleep(POLICY.probeIntervalMs * 3);

    await writeFile(join(repo, 'README.md'), 'second\n');
    await git(repo, ['commit', '-q', '-am', 'second']);
    await waitFor(
      () => patchUnits(fake.calls).some((u) => u.kind === 'upstream' && u.commitsAhead === 1),
      'upstream unit one commit ahead'
    );

    const mark = fake.calls.length;
    await git(repo, ['push', '-q', 'origin', 'x']);
    await waitFor(
      () =>
        patchUnits(fake.calls.slice(mark)).some(
          (u) => u.kind === 'upstream' && u.commitsAhead === 0 && u.commitsBehind === 0
        ),
      'upstream unit after push'
    );
    expectOnlyChangeDrivenCalls(fake.calls);

    await sleep(POLICY.probeIntervalMs * 3);
    const quietFrom = fake.calls.length;
    await sleep(POLICY.probeIntervalMs * 10);
    expect(fake.calls.slice(quietFrom)).toEqual([]);
  });

  it('sends nothing while no agent is active, and an explicit refresh still sends the units', async () => {
    const fake = createFakeBackend();
    const h = start(fake, { agents: [] });

    await editReadme('second\n');
    await git(repo, ['commit', '-q', '-am', 'second']);
    await editReadme('edited\n');
    await sleep(POLICY.probeIntervalMs * 3);

    expect(fake.calls).toEqual([]);
    expect(h.service.isRegistered(repo)).toBe(true);

    await h.service.refresh(repo, 'command');
    await waitFor(
      () =>
        patchUnits(fake.calls).some((u) => u.kind === 'head') &&
        worktreeUnits(fake.calls).length > 0,
      'head and worktree units from an explicit refresh'
    );
  });

  it('starts syncing with the head-first initial snapshot within 5s when an agent starts', async () => {
    const fake = createFakeBackend();
    const h = start(fake, { agents: [] });
    await sleep(POLICY.probeIntervalMs * 3);
    expect(fake.calls).toEqual([]);

    h.presence.set([agentIn(repo)]);
    await waitFor(
      () => patchUnits(fake.calls).some((u) => u.kind === 'checks'),
      'initial snapshot after an agent starts',
      5_000
    );
    await waitFor(() => fake.calls.some((c) => c.name === SYNC_COMMANDS), 'commands', 5_000);
    await waitFor(
      () => fake.calls.some((c) => c.name === UPSERT_RECENT_COMMITS),
      'recent commits',
      5_000
    );

    expect(patchUnits(fake.calls)[0]?.kind).toBe('head');
    expect(fake.calls.filter((c) => c.name === SYNC_COMMANDS)).toHaveLength(1);
  });

  it('flushes the last edit and stops when the last agent exits', async () => {
    const fake = createFakeBackend();
    const h = start(fake);
    await waitFor(() => worktreeUnits(fake.calls).length > 0, 'initial worktree unit');
    await sleep(POLICY.probeIntervalMs * 3);

    // The edit lands, then the last agent exits before the next probe tick. Only the final flush
    // can send it, because the probe stops with the agent.
    await editReadme('hello\nworld\n');
    h.presence.set([]);
    await waitFor(
      () =>
        worktreeUnits(fake.calls).some(
          (u) => u.isDirty && u.diffStat.insertions === 2 && u.diffStat.deletions === 1
        ),
      'final flush of the last edit',
      5_000
    );
    await sleep(POLICY.probeIntervalMs * 3);

    const mark = fake.calls.length;
    await editReadme('hello\nworld\nmore\nlines\n');
    await sleep(POLICY.probeIntervalMs * 3);
    expect(fake.calls.length).toBe(mark);
  });

  it('keeps a directory active while one of two agents runs, and stops when the last one exits', async () => {
    const fake = createFakeBackend();
    const h = start(fake, { agents: [agentIn(repo, 'builder'), agentIn(repo, 'reviewer')] });
    await waitFor(() => worktreeUnits(fake.calls).length > 0, 'initial worktree unit');
    await sleep(POLICY.probeIntervalMs * 3);

    // One of the two agents exits. The directory is still active, so an edit is sent.
    h.presence.set([agentIn(repo, 'reviewer')]);
    await sleep(POLICY.probeIntervalMs * 3);
    const mark = fake.calls.length;
    await editReadme('still active\n');
    await waitFor(
      () =>
        worktreeUnits(fake.calls.slice(mark)).some(
          (u) => u.diffStat.insertions === 1 && u.diffStat.deletions === 1
        ),
      'worktree unit while one agent still runs',
      5_000
    );
    await sleep(POLICY.probeIntervalMs * 3);

    // The last agent exits. Its final flush sends the edit made just before it.
    await editReadme('still active\nlast\n');
    h.presence.set([]);
    await waitFor(
      () =>
        worktreeUnits(fake.calls.slice(mark)).some(
          (u) => u.diffStat.insertions === 2 && u.diffStat.deletions === 1
        ),
      'final flush after the last agent exits',
      5_000
    );
    await sleep(POLICY.probeIntervalMs * 3);

    const quietFrom = fake.calls.length;
    await editReadme('after\n');
    await sleep(POLICY.probeIntervalMs * 3);
    expect(fake.calls.length).toBe(quietFrom);
  });

  it('a dead agent does not keep the workspace active', async () => {
    const fake = createFakeBackend();
    const fixture = createAgentProcessFixture();
    const h = start(fake, { agents: [], presenceSource: managerPresence(fixture.manager) });

    // The first agent starts through the real manager. Its spawn notifies presence, so the
    // directory activates.
    const started = await fixture.manager.ensureRunning(agentStart(repo, 'builder'));
    expect(started.success).toBe(true);
    await waitFor(() => worktreeUnits(fake.calls).length > 0, 'initial worktree unit', 5_000);
    await sleep(POLICY.probeIntervalMs * 3);

    // The first agent dies without an exit callback. An edit lands while the directory still looks
    // active, so the final flush below has something to send.
    fixture.markDead(FIRST_AGENT_PID);
    await editReadme('dead agent edit\n');

    // A second agent starts in a directory that is not registered. Its spawn notifies presence,
    // so the service re-reads presence while the first agent's pid is dead.
    const other = await fixture.manager.ensureRunning(
      agentStart('/unregistered-dir', 'reviewer', 'chatroom-other')
    );
    expect(other.success).toBe(true);
    await waitFor(
      () =>
        worktreeUnits(fake.calls).some(
          (u) => u.diffStat.insertions === 1 && u.diffStat.deletions === 1
        ),
      'final flush of the edit made after the agent died',
      5_000
    );
    await sleep(POLICY.probeIntervalMs * 3);

    // This edit changes the diffStat (two insertions), so an unchanged-unit dedup cannot hide a send.
    const mark = fake.calls.length;
    await editReadme('after the death\nmore\n');
    await sleep(POLICY.probeIntervalMs * 3);
    expect(fake.calls.length).toBe(mark);
    expect(h.service.isRegistered(repo)).toBe(true);
  });

  it('a presence for a non-member creates no sync, and a membership update activates it at once', async () => {
    const fake = createFakeBackend();
    const h = start(fake, { members: [], agents: [agentIn(repo)] });
    await sleep(POLICY.probeIntervalMs * 3);

    expect(fake.calls).toEqual([]);
    expect(h.service.isRegistered(repo)).toBe(false);

    h.membership.set([repo]);
    await waitFor(
      () => patchUnits(fake.calls).some((u) => u.kind === 'checks'),
      'initial snapshot after the directory is registered',
      5_000
    );
    expect(patchUnits(fake.calls)[0]?.kind).toBe('head');
  });
});
