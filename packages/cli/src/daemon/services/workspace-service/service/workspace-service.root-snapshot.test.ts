/**
 * The probe-backed root snapshot seam, as `createWorkspaceService` wires it.
 *
 * Real git repositories under the OS temp dir. Every workspace is registered in the idle tier, so
 * no monitor loop runs and the only real I/O is git. The reader is read from the file-tree host
 * that the service builds, so these tests cover the production wiring, not a copy of it.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceService, type WorkspaceServiceDeps } from './workspace-service.js';
import type { GitRootSnapshotReader } from '../../../../infrastructure/services/workspace/git-workspace-change-source.js';
import type { GitRepoNode } from '../../../../infrastructure/services/workspace/git-workspace-hierarchy.js';
import {
  readGitHead,
  readGitPorcelainStatus,
  readGitStatusV2,
} from '../../../../infrastructure/services/workspace/git-workspace-porcelain.js';
import { normalizeWorkingDirForLookup } from '../../../../infrastructure/services/workspace/normalize-working-dir.js';
import {
  startWorkspaceFileTreeCoordinator,
  type WorkspaceFileTreeCoordinator,
} from '../../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import { clearWorkspaceSyncStateForTests } from '../../../../infrastructure/services/workspace/workspace-sync-state.js';
import type * as RunCommandModule from '../../../infrastructure/git/run-command.js';
import type { WorkspaceActivityRow } from '../domain/observation-tier.js';
import {
  DEFAULT_WORKSPACE_SYNC_POLICY,
  resolveWorkspaceSyncPolicy,
  type DeepPartial,
  type WorkspaceSyncPolicy,
} from '../domain/workspace-sync-policy.js';
import type { WorkspaceActivitySource } from '../infrastructure/workspace-activity-source.js';
import {
  createWorkspaceGitProbe,
  type WorkspaceGitProbe,
} from '../infrastructure/workspace-git-probe.js';

type ReaderFactory = (workingDir: string) => Promise<GitRootSnapshotReader | undefined>;

/** The argument list of every git process spawned through `runGit`, in spawn order. */
const gitSpawns = vi.hoisted(() => [] as string[][]);

// Passthrough spy on the one git runner. Every probe read and rename-limit read goes through it.
vi.mock('../../../infrastructure/git/run-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RunCommandModule>();
  return {
    ...actual,
    runGit: (...args: Parameters<typeof actual.runGit>) => {
      gitSpawns.push(args[0]);
      return actual.runGit(...args);
    },
  };
});

// The real host is kept; the mock only records the `getRootSnapshotReader` the service wired in.
const wiredHost = vi.hoisted(() => ({
  getRootSnapshotReader: undefined as ReaderFactory | undefined,
}));

vi.mock('./workspace-file-tree-host.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const createHost = actual.createWorkspaceFileTreeHost as (deps: {
    getRootSnapshotReader: ReaderFactory;
  }) => unknown;
  return {
    ...actual,
    createWorkspaceFileTreeHost: (deps: { getRootSnapshotReader: ReaderFactory }) => {
      wiredHost.getRootSnapshotReader = deps.getRootSnapshotReader;
      return createHost(deps);
    },
  };
});

type RootView = {
  head: { head: string | null };
  entries: { xy: string; path: string; fromPath: string | undefined }[];
};

/** Fake activity source: the service subscribes once and the test pushes rows. */
function fakeActivitySource() {
  let onRows: ((rows: readonly WorkspaceActivityRow[]) => void) | null = null;
  const source: WorkspaceActivitySource = {
    subscribe: (cb) => {
      onRows = cb;
      return () => {
        onRows = null;
      };
    },
  };
  return {
    source,
    push(rows: WorkspaceActivityRow[]) {
      if (onRows === null) throw new Error('activity source is not subscribed');
      onRows(rows);
    },
  };
}

const services: { stopAll(): Promise<void> }[] = [];

type StartOptions = {
  /** Default: a real probe per directory. */
  createProbe?: (workingDir: string) => WorkspaceGitProbe;
  policy?: DeepPartial<WorkspaceSyncPolicy>;
  /** Default `Date.now`. Shared by the service and the default probe. */
  now?: () => number;
};

/**
 * Starts a service that registers `workingDirs` and returns the reader factory it wired into the
 * file-tree host.
 */
async function startService(
  workingDirs: string[],
  options: StartOptions = {}
): Promise<ReaderFactory> {
  wiredHost.getRootSnapshotReader = undefined;
  const activity = fakeActivitySource();
  const now = options.now ?? Date.now;
  const service = createWorkspaceService({
    activitySource: activity.source,
    outbox: { enqueue: vi.fn(), stopKeys: vi.fn() },
    policy: resolveWorkspaceSyncPolicy(options.policy),
    now,
    createProbe:
      options.createProbe ??
      ((workingDir) =>
        createWorkspaceGitProbe({
          workTree: workingDir,
          rootPathspec: [],
          dirtyStatCap: 500,
          now,
        })),
    sessionId: 'root-snapshot-test-session' as WorkspaceServiceDeps['sessionId'],
    machineId: 'root-snapshot-test',
    backend: { mutation: vi.fn(async () => undefined), query: vi.fn(async () => null) },
  });
  services.push(service);
  service.start();
  activity.push(
    workingDirs.map((workingDir) => ({
      workingDir: normalizeWorkingDirForLookup(workingDir),
      lastObservedAt: null,
    }))
  );
  if (!wiredHost.getRootSnapshotReader) throw new Error('the service did not wire a reader');
  return wiredHost.getRootSnapshotReader;
}

/** The reader for a registered directory. Fails the test when none is returned. */
async function readerFor(
  getReader: ReaderFactory,
  workingDir: string
): Promise<GitRootSnapshotReader> {
  const reader = await getReader(normalizeWorkingDirForLookup(workingDir));
  if (!reader) throw new Error(`expected a root snapshot reader for ${workingDir}`);
  return reader;
}

let root = '';
let repo = '';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
}

async function write(dir: string, relPath: string, content: string): Promise<void> {
  const abs = path.join(dir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

async function initRepo(name: string): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'root-snapshot@example.com');
  git(dir, 'config', 'user.name', 'Root Snapshot');
  return dir;
}

/** The v1 root read: the direct HEAD and status reads the consumer uses for the root node. */
async function readV1Root(workTree: string, pathspec: string[]): Promise<RootView> {
  const node: GitRepoNode = {
    workTree,
    gitDir: path.join(workTree, '.git'),
    relativePath: '',
    pathspec,
    children: [],
  };
  const [head, entries] = await Promise.all([readGitHead(workTree), readGitPorcelainStatus(node)]);
  return {
    head,
    entries: entries.map(({ xy, path: p, fromPath }) => ({ xy, path: p, fromPath })),
  };
}

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'root-snapshot-')));
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await fs.rm(root, { recursive: true, force: true });
});

describe('root snapshot reader wired by createWorkspaceService', () => {
  it('resolves undefined for a directory that has no monitor', async () => {
    const getReader = await startService([]);

    expect(await getReader(path.join(root, 'not-registered'))).toBeUndefined();
  });

  it('projects a subdirectory workspace to the same head and entries as v1, in v1 order', async () => {
    repo = await initRepo('subdir');
    await write(repo, 'packages/cli/a.ts', 'a1\n');
    await write(repo, 'packages/cli/sub/b.ts', 'b1\n');
    await write(repo, 'apps/web/c.ts', 'c1\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    await write(repo, 'packages/cli/a.ts', 'a2\n'); // unstaged modification
    await write(repo, 'packages/cli/staged.ts', 'staged\n');
    git(repo, 'add', 'packages/cli/staged.ts'); // staged add
    await write(repo, 'packages/cli/new.ts', 'new\n'); // untracked, inside
    await write(repo, 'apps/web/x.ts', 'x\n'); // untracked, outside
    await fs.rm(path.join(repo, 'packages/cli/sub/b.ts')); // unstaged delete

    const workingDir = path.join(repo, 'packages/cli');
    const reader = await readerFor(await startService([workingDir]), workingDir);
    const projected = await reader(['packages/cli']);

    expect(projected).toEqual(await readV1Root(repo, ['packages/cli']));
  });

  it('an empty pathspec on a repo-root workspace matches the full v1 status', async () => {
    repo = await initRepo('root-workspace');
    await write(repo, 'a.ts', 'a1\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    await write(repo, 'a.ts', 'a2\n');
    await write(repo, 'b.ts', 'b1\n');

    const reader = await readerFor(await startService([repo]), repo);

    expect(await reader([])).toEqual(await readV1Root(repo, []));
  });

  it.each([
    ['wholly inside the pathspec', 'packages/cli/rename-me.ts', 'packages/cli/renamed.ts'],
    ['from inside to outside the pathspec', 'packages/cli/rename-me.ts', 'apps/web/renamed.ts'],
  ])('declines a rename %s, so the consumer reads v1', async (label, from, to) => {
    repo = await initRepo(`rename-${label.replace(/\W+/g, '-')}`);
    await write(repo, from, 'r1\n');
    await write(repo, 'apps/web/keep.ts', 'k1\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'mv', from, to);

    const workingDir = path.join(repo, 'packages/cli');
    const reader = await readerFor(await startService([workingDir]), workingDir);

    expect(await reader(['packages/cli'])).toBeUndefined();
  });

  it('rejects when the probe read fails, so the change source reports it through onError', async () => {
    const notARepo = path.join(root, 'plain-directory');
    await fs.mkdir(notARepo);
    const reader = await readerFor(await startService([notARepo]), notARepo);

    await expect(reader([])).rejects.toThrow();
  });

  it('the reader reads through the probe the monitor owns', async () => {
    repo = await initRepo('shared-probe');
    await write(repo, 'a.ts', 'a1\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    const readStatus = vi.fn(readGitStatusV2);
    const getReader = await startService([repo], {
      createProbe: (workingDir) =>
        createWorkspaceGitProbe({
          workTree: workingDir,
          rootPathspec: [],
          dirtyStatCap: 500,
          readStatus,
        }),
    });

    const reader = await readerFor(getReader, repo);
    await reader([]);

    expect(readStatus).toHaveBeenCalledWith(repo);
  });
});

describe('root tick shares the monitor probe', () => {
  const INTERVAL = DEFAULT_WORKSPACE_SYNC_POLICY.probeIntervalMs;
  const START = 1_000_000;
  /** Fake clock shared by the service and its probe, so ages are exact. */
  let clock = START;
  const now = (): number => clock;

  beforeEach(() => {
    clock = START;
    gitSpawns.length = 0;
  });

  /** How many git processes with this subcommand were spawned since the last reset. */
  const spawnsOf = (subcommand: string): number =>
    gitSpawns.filter((args) => args[0] === subcommand).length;

  /**
   * A repo with one dirty file, and a reader wired through the probe the service owns. The probe
   * is returned so a test can make the monitor's own tick call on it.
   */
  async function setup(): Promise<{ probe: WorkspaceGitProbe; reader: GitRootSnapshotReader }> {
    const dir = await initRepo('probe-sharing');
    await write(dir, 'a.ts', 'a1\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
    await write(dir, 'a.ts', 'a2\n');
    const probe = createWorkspaceGitProbe({
      workTree: dir,
      rootPathspec: [],
      dirtyStatCap: 500,
      now,
    });
    const getReader = await startService([dir], { now, createProbe: () => probe });
    return { probe, reader: await readerFor(getReader, dir) };
  }

  it('a root tick inside the probe interval adds no git status spawn', async () => {
    const { probe, reader } = await setup();

    // The monitor's probe tick. An observed monitor makes this call on every tick.
    await probe.readSnapshot({ maxAgeMs: 0 });
    expect(spawnsOf('status')).toBe(1);
    expect(spawnsOf('config')).toBe(0);

    await reader([]);
    expect(spawnsOf('status')).toBe(1);
    // The first root tick reads the rename limit once.
    expect(spawnsOf('config')).toBe(1);

    clock += 1_000;
    await reader([]);
    expect(spawnsOf('status')).toBe(1);
    expect(spawnsOf('config')).toBe(1);
  });

  it('re-reads git once the snapshot is older than one probe interval', async () => {
    const { probe, reader } = await setup();
    await probe.readSnapshot({ maxAgeMs: 0 });

    clock += INTERVAL; // exactly one interval old: still reused
    await reader([]);
    expect(spawnsOf('status')).toBe(1);

    clock += 1; // older than one interval: re-read
    await reader([]);
    expect(spawnsOf('status')).toBe(2);
  });

  it('re-reads the rename limit once it is older than ten probe intervals', async () => {
    const { reader } = await setup();
    await reader([]);
    expect(spawnsOf('config')).toBe(1);

    clock += 10 * INTERVAL; // exactly ten intervals old: still cached
    await reader([]);
    expect(spawnsOf('config')).toBe(1);

    clock += 1;
    await reader([]);
    expect(spawnsOf('config')).toBe(2);
  });
});

describe('file-tree coordinator with the probe-backed root reader', () => {
  /** Lets the poll run for an edit that changes no tree entry, such as a staged add. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200));

  /** The coordinator's tree as sorted `path:type` tokens. */
  function treeOf(coordinator: WorkspaceFileTreeCoordinator): string[] {
    return coordinator
      .getTree()
      .entries.map((entry) => `${entry.path}:${entry.type}`)
      .sort();
  }

  /**
   * Waits until the coordinator's tree equals `expected`. Each step waits for its own result, so
   * no two steps can land in one poll and the delta batches are the same in every run.
   */
  async function waitForTree(
    coordinator: WorkspaceFileTreeCoordinator,
    expected: string[]
  ): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (JSON.stringify(treeOf(coordinator)) !== JSON.stringify(expected)) {
      if (Date.now() >= deadline) {
        throw new Error(
          `timed out waiting for tree ${expected.join(', ')}; saw ${treeOf(coordinator).join(', ')}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Each delta as sorted `+path` / `-path` / `~path` tokens, so runs compare by content. */
  function normalizeDelta(delta: {
    added: { path: string }[];
    removed: string[];
    typeChanged: { path: string }[];
  }): string[] {
    return [
      ...delta.added.map((entry) => `+${entry.path}`),
      ...delta.removed.map((entry) => `-${entry}`),
      ...delta.typeChanged.map((entry) => `~${entry.path}`),
    ].sort();
  }

  /**
   * Runs one fixed edit sequence in `repo` through a coordinator for `workingDir`. Returns the
   * deltas it sent, the final tree, and any coordinator errors. Each edit is followed by a settle,
   * so every edit is observed by its own poll.
   */
  async function runEditSequence(args: {
    repo: string;
    workingDir: string;
    machineId: string;
    readRootSnapshot: GitRootSnapshotReader | undefined;
  }): Promise<{ deltas: string[][]; tree: string[]; errors: unknown[] }> {
    const { repo: dir } = args;
    const deltas: string[][] = [];
    const errors: unknown[] = [];
    const coordinator: WorkspaceFileTreeCoordinator = await startWorkspaceFileTreeCoordinator({
      machineId: args.machineId,
      workingDir: args.workingDir,
      changeSourcePollIntervalMs: 20,
      readRootSnapshot: args.readRootSnapshot,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: async (delta, baseRevision) => {
        deltas.push(normalizeDelta(delta));
        return { status: 'applied', revision: baseRevision + 1 };
      },
      onError: (error) => {
        errors.push(error);
      },
    });
    try {
      await waitForTree(coordinator, ['a.ts:file', 'b.ts:file']);
      await write(dir, 'packages/cli/a.ts', 'a2\n'); // modified tracked file: no tree change
      await write(dir, 'packages/cli/new.ts', 'new\n'); // untracked, inside the pathspec
      await write(dir, 'apps/web/x.ts', 'x\n'); // untracked, outside the pathspec
      await waitForTree(coordinator, ['a.ts:file', 'b.ts:file', 'new.ts:file']);
      await fs.rm(path.join(dir, 'packages/cli/b.ts')); // deleted tracked file
      await waitForTree(coordinator, ['a.ts:file', 'new.ts:file']);
      git(dir, 'mv', 'packages/cli/a.ts', 'packages/cli/renamed.ts'); // inside rename: declined
      await waitForTree(coordinator, ['new.ts:file', 'renamed.ts:file']);
      git(dir, 'mv', 'packages/cli/renamed.ts', 'packages/cli/a.ts'); // rename undone: accepted
      await waitForTree(coordinator, ['a.ts:file', 'new.ts:file']);
      git(dir, 'add', 'packages/cli/new.ts'); // staged add: no tree change
      await settle();
      return { deltas, tree: treeOf(coordinator), errors };
    } finally {
      await coordinator.stop();
      await clearWorkspaceSyncStateForTests(args.machineId, args.workingDir);
    }
  }

  it('sends the same deltas as the v1 path, reading the probe on accepted ticks and v1 on declined ticks', async () => {
    /** A repo with the same committed files each time. Returns the repo's root. */
    const seed = async (name: string): Promise<string> => {
      const dir = await initRepo(name);
      await write(dir, 'packages/cli/a.ts', 'a1\n');
      await write(dir, 'packages/cli/b.ts', 'b1\n');
      await write(dir, 'apps/web/c.ts', 'c1\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'init');
      return dir;
    };

    const v1Repo = await seed('events-v1');
    const v1 = await runEditSequence({
      repo: v1Repo,
      workingDir: path.join(v1Repo, 'packages/cli'),
      machineId: `root-snapshot-v1-${process.pid}`,
      readRootSnapshot: undefined,
    });

    const probeRepo = await seed('events-probe');
    const probeDir = path.join(probeRepo, 'packages/cli');
    const readStatus = vi.fn(readGitStatusV2);
    const getReader = await startService([probeDir], {
      // Short probe interval: a reused snapshot must not hold up the edit sequence for seconds.
      policy: { probeIntervalMs: 50 },
      createProbe: (workingDir) =>
        createWorkspaceGitProbe({
          workTree: workingDir,
          rootPathspec: [],
          dirtyStatCap: 500,
          readStatus,
        }),
    });
    const inner = await readerFor(getReader, probeDir);
    const decisions: ('accepted' | 'declined')[] = [];
    const readRootSnapshot: GitRootSnapshotReader = async (rootPathspec) => {
      const snapshot = await inner(rootPathspec);
      decisions.push(snapshot === undefined ? 'declined' : 'accepted');
      return snapshot;
    };
    const probe = await runEditSequence({
      repo: probeRepo,
      workingDir: probeDir,
      machineId: `root-snapshot-probe-${process.pid}`,
      readRootSnapshot,
    });

    expect(v1.errors).toEqual([]);
    expect(probe.errors).toEqual([]);
    expect(decisions).toContain('accepted');
    expect(decisions).toContain('declined');
    expect(readStatus).toHaveBeenCalled();
    expect(probe.deltas).toEqual(v1.deltas);
    expect(probe.tree).toEqual(v1.tree);
    expect(probe.tree).toEqual(['a.ts:file', 'new.ts:file']);
  });
});
