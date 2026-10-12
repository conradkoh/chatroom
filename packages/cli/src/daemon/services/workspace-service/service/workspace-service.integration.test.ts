/**
 * End-to-end test of the wired WorkspaceService against a real git repository.
 *
 * Real: git (temp repo with a bare origin), the git probe, the local and remote collectors, the
 * monitor, the service, and the durable workspace-state outbox (SQLite under a temp HOME).
 * Faked: the backend mutation (records calls and can be made to fail) and the activity source
 * (reports the repository as observed). The GitHub readers are stubbed because they need `gh`.
 *
 * Run with: vitest run --config vitest.integration.config.ts
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceService, type WorkspaceService } from './workspace-service.js';
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
import type { WorkspaceActivityRow } from '../domain/observation-tier.js';
import type { WorkspaceStateUnit } from '../domain/workspace-state-unit.js';
import {
  resolveWorkspaceSyncPolicy,
  type WorkspaceSyncPolicy,
} from '../domain/workspace-sync-policy.js';
import type { WorkspaceActivitySource } from '../infrastructure/workspace-activity-source.js';

// The GitHub readers shell out to `gh`. Stub only those two; the git readers stay real.
vi.mock('../../../infrastructure/git/git-reader.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readOpenPRsForBranch: vi.fn(async () => ({ ok: true, value: [] })),
  readCommitStatusChecks: vi.fn(async () => ({ ok: true, value: null })),
}));

const execFileAsync = promisify(execFile);
const MACHINE_ID = 'machine-integration';
const SESSION_ID = 'session-integration' as SessionId;

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

/** Reports the repository as observed right now, so it is in the observed tier. */
function observedActivitySource(workingDir: string): WorkspaceActivitySource {
  return {
    subscribe(onRows) {
      const rows: WorkspaceActivityRow[] = [{ workingDir, lastObservedAt: Date.now() }];
      onRows(rows);
      return () => undefined;
    },
  };
}

type Harness = {
  service: WorkspaceService;
  registry: WorkspaceStateOutboxRegistry;
  fake: FakeBackend;
};

/** Starts the real service and durable outbox on top of `fake`. */
function startHarness(workingDir: string, fake: FakeBackend): Harness {
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
    activitySource: observedActivitySource(workingDir),
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
  });
  service.start();
  return { service, registry, fake };
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

describe('WorkspaceService end-to-end (real git, real outbox)', () => {
  let tmp: string;
  let home: string;
  let repo: string;
  let originalHome: string | undefined;
  const open: Harness[] = [];

  /** Starts a harness and tracks it so afterEach can stop it even when a test fails. */
  function start(fake: FakeBackend): Harness {
    const harness = startHarness(repo, fake);
    open.push(harness);
    return harness;
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
});
