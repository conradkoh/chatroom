import { describe, test, expect, vi, beforeEach } from 'vitest';

import { syncCommitDetails } from './commit-detail-sync.js';
import type { DaemonContext } from './types.js';

// ─── Mock git-reader before importing the module under test ──────────────────

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(true),
  getBranch: vi.fn(),
  isDirty: vi.fn(),
  getDiffStat: vi.fn(),
  getRecentCommits: vi.fn(),
  getCommitsAhead: vi.fn(),
  getRemotes: vi.fn(),
  getOpenPRsForBranch: vi.fn(),
  getAllPRs: vi.fn(),
  getCommitStatusChecks: vi.fn(),
  getCommitDetail: vi.fn(),
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** A minimal GitCommit for testing. */
function makeCommit(sha: string) {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: `commit ${sha}`,
    author: 'Test Author',
    date: '2025-01-15T10:00:00+00:00',
  };
}

/** Create a minimal mock DaemonContext with spied backend methods. */
function makeMockContext(overrides?: Partial<DaemonContext>): DaemonContext {
  return {
    client: null,
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null,
    events: {} as DaemonContext['events'],
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    deps: {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockImplementation((_fn: unknown, args: { shas?: string[] }) => {
          // Default: all SHAs are missing
          const shas = args?.shas ?? [];
          return Promise.resolve(shas);
        }),
      },
    },
    ...overrides,
  } as unknown as DaemonContext;
}

const WORKING_DIR = '/test/repo';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('syncCommitDetails', () => {
  let ctx: DaemonContext;

  beforeEach(() => {
    ctx = makeMockContext();
    vi.clearAllMocks();
  });

  // ── Scenario 1: First call populates seenShas from backend response ──────

  test('first call populates seenShas from backend response', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');

    // One workspace with 3 commits
    vi.mocked(ctx.deps.backend.query).mockImplementation((_fn: unknown, args: unknown) => {
      const a = args as Record<string, unknown>;
      // listWorkspacesForMachine
      if (a.workingDir === undefined && a.shas === undefined) {
        return Promise.resolve([{ workingDir: WORKING_DIR }]);
      }
      // getMissingCommitShasV2 — only 'a' is missing
      return Promise.resolve(['a']);
    });

    const commits = [makeCommit('a'), makeCommit('b'), makeCommit('c')];
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(commits);
    vi.mocked(gitReader.getCommitDetail).mockResolvedValue({
      status: 'available',
      content: 'diff for a',
      truncated: false,
    });

    const seenMap = new Map<string, Set<string>>();
    await syncCommitDetails(ctx, seenMap);

    // getMissingCommitShasV2 called once with all candidate SHAs
    const queryCalls = (ctx.deps.backend.query as ReturnType<typeof vi.fn>).mock.calls;
    const missingCall = queryCalls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.shas !== undefined
    );
    expect(missingCall).toBeDefined();
    expect((missingCall![1] as Record<string, unknown>).shas).toEqual(['a', 'b', 'c']);

    // upsertCommitDetailV2 called once for 'a'
    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    const upsertCalls = mutationCalls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.sha !== undefined
    );
    expect(upsertCalls).toHaveLength(1);
    expect((upsertCalls[0][1] as Record<string, unknown>).sha).toBe('a');

    // All three SHAs end up in the seen set
    const seen = seenMap.get(`test-machine::${WORKING_DIR}`)!;
    expect(seen).toBeDefined();
    expect(seen.has('a')).toBe(true);
    expect(seen.has('b')).toBe(true);
    expect(seen.has('c')).toBe(true);
  });

  // ── Scenario 2: Second call with same SHAs makes NO backend query ─────────

  test('second call with same SHAs makes NO backend query', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');

    vi.mocked(ctx.deps.backend.query).mockImplementation((_fn: unknown, args: unknown) => {
      const a = args as Record<string, unknown>;
      if (a.workingDir === undefined && a.shas === undefined) {
        return Promise.resolve([{ workingDir: WORKING_DIR }]);
      }
      return Promise.resolve(['a']);
    });

    const commits = [makeCommit('a'), makeCommit('b'), makeCommit('c')];
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(commits);
    vi.mocked(gitReader.getCommitDetail).mockResolvedValue({
      status: 'available',
      content: 'diff',
      truncated: false,
    });

    const seenMap = new Map<string, Set<string>>();

    // First call
    await syncCommitDetails(ctx, seenMap);

    // Reset mocks to count second-call invocations
    const queryFn = ctx.deps.backend.query as ReturnType<typeof vi.fn>;
    const mutationFn = ctx.deps.backend.mutation as ReturnType<typeof vi.fn>;
    queryFn.mockClear();
    mutationFn.mockClear();
    vi.mocked(gitReader.getRecentCommits).mockClear();

    // Second call — same commits should all be seen already
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(commits);

    await syncCommitDetails(ctx, seenMap);

    // listWorkspacesForMachine is still called (we always fetch workspace list)
    // But getMissingCommitShasV2 should NOT be called — no candidates
    const secondQueryCalls = queryFn.mock.calls;
    const missingCall = secondQueryCalls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.shas !== undefined
    );
    expect(missingCall).toBeUndefined();

    // No upsertCommitDetailV2 calls
    const upsertCalls = mutationFn.mock.calls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.sha !== undefined
    );
    expect(upsertCalls).toHaveLength(0);
  });

  // ── Scenario 3: New SHA triggers a query for only that SHA ────────────────

  test('new SHA triggers a query for only that SHA', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');

    // Pre-populated seen set: b and c are already known
    const seenMap = new Map<string, Set<string>>();
    seenMap.set(`test-machine::${WORKING_DIR}`, new Set(['b', 'c']));

    vi.mocked(ctx.deps.backend.query).mockImplementation((_fn: unknown, args: unknown) => {
      const a = args as Record<string, unknown>;
      if (a.workingDir === undefined && a.shas === undefined) {
        return Promise.resolve([{ workingDir: WORKING_DIR }]);
      }
      // Only 'd' is actually missing on the backend
      return Promise.resolve(['d']);
    });

    const commits = [makeCommit('b'), makeCommit('c'), makeCommit('d')];
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(commits);
    vi.mocked(gitReader.getCommitDetail).mockResolvedValue({
      status: 'available',
      content: 'diff for d',
      truncated: false,
    });

    await syncCommitDetails(ctx, seenMap);

    // getMissingCommitShasV2 called with ['d'] only
    const queryCalls = (ctx.deps.backend.query as ReturnType<typeof vi.fn>).mock.calls;
    const missingCall = queryCalls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.shas !== undefined
    );
    expect(missingCall).toBeDefined();
    expect((missingCall![1] as Record<string, unknown>).shas).toEqual(['d']);

    // upsertCommitDetailV2 called once for 'd'
    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    const upsertCalls = mutationCalls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.sha !== undefined
    );
    expect(upsertCalls).toHaveLength(1);
    expect((upsertCalls[0][1] as Record<string, unknown>).sha).toBe('d');
  });

  // ── Scenario 4: Multiple workspaces are independent ───────────────────────

  test('multiple workspaces are independent', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');
    const workspaceA = '/test/repo-a';
    const workspaceB = '/test/repo-b';

    vi.mocked(ctx.deps.backend.query).mockImplementation((_fn: unknown, args: unknown) => {
      const a = args as Record<string, unknown>;
      // listWorkspacesForMachine
      if (a.workingDir === undefined && a.shas === undefined) {
        return Promise.resolve([{ workingDir: workspaceA }, { workingDir: workspaceB }]);
      }
      // getMissingCommitShasV2 — all SHAs are missing
      return Promise.resolve((a.shas as string[]) ?? []);
    });

    // Both workspaces have commit 'a' (same SHA)
    const commits = [makeCommit('a')];
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(commits);
    vi.mocked(gitReader.getCommitDetail).mockResolvedValue({
      status: 'available',
      content: 'diff',
      truncated: false,
    });

    const seenMap = new Map<string, Set<string>>();

    await syncCommitDetails(ctx, seenMap);

    // Both workspaces should have independent seen sets
    const seenA = seenMap.get(`test-machine::${workspaceA}`);
    const seenB = seenMap.get(`test-machine::${workspaceB}`);
    expect(seenA).toBeDefined();
    expect(seenB).toBeDefined();
    expect(seenA!.has('a')).toBe(true);
    expect(seenB!.has('a')).toBe(true);

    // getMissingCommitShasV2 called once per workspace
    const queryCalls = (ctx.deps.backend.query as ReturnType<typeof vi.fn>).mock.calls;
    const missingCalls = queryCalls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.shas !== undefined
    );
    expect(missingCalls).toHaveLength(2);
  });

  // ── Scenario 5: Backend listWorkspacesForMachine error returns without throw ──

  test('listWorkspacesForMachine error returns without throwing', async () => {
    (ctx.deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('backend down')
    );

    // Should not throw
    await expect(syncCommitDetails(ctx)).resolves.toBeUndefined();
  });

  // ── Scenario 6: Per-workspace error does not stop other workspaces ────────

  test('per-workspace error does not stop other workspaces', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');
    const workspaceA = '/test/repo-a';
    const workspaceB = '/test/repo-b';

    vi.mocked(ctx.deps.backend.query).mockImplementation((_fn: unknown, args: unknown) => {
      const a = args as Record<string, unknown>;
      if (a.workingDir === undefined && a.shas === undefined) {
        return Promise.resolve([{ workingDir: workspaceA }, { workingDir: workspaceB }]);
      }
      return Promise.resolve((a.shas as string[]) ?? []);
    });

    // Workspace A throws; workspace B should still complete
    vi.mocked(gitReader.getRecentCommits).mockImplementation(async (wd: string) => {
      if (wd === workspaceA) throw new Error('git exploded');
      return [makeCommit('x')];
    });
    vi.mocked(gitReader.getCommitDetail).mockResolvedValue({
      status: 'available',
      content: 'diff',
      truncated: false,
    });

    await syncCommitDetails(ctx);

    // getRecentCommits called for both workspaces
    expect(gitReader.getRecentCommits).toHaveBeenCalledTimes(2);

    // Workspace B still completed its sync
    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    const upsertCalls = mutationCalls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.sha !== undefined
    );
    expect(upsertCalls).toHaveLength(1); // Only workspace B's update
  });

  // ── Scenario 7: Module-scope seenShas is used when no map is injected ─────

  test('uses module-scope seenShas when no injection map is provided', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');

    vi.mocked(ctx.deps.backend.query).mockImplementation((_fn: unknown, args: unknown) => {
      const a = args as Record<string, unknown>;
      if (a.workingDir === undefined && a.shas === undefined) {
        return Promise.resolve([{ workingDir: WORKING_DIR }]);
      }
      return Promise.resolve(['a']);
    });

    const commits = [makeCommit('a'), makeCommit('b')];
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(commits);
    vi.mocked(gitReader.getCommitDetail).mockResolvedValue({
      status: 'available',
      content: 'diff',
      truncated: false,
    });

    // Call without injection — uses module scope
    await syncCommitDetails(ctx);

    // getMissingCommitShasV2 was called with both SHAs
    const queryCalls = (ctx.deps.backend.query as ReturnType<typeof vi.fn>).mock.calls;
    const missingCall = queryCalls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.shas !== undefined
    );
    expect(missingCall).toBeDefined();
    expect((missingCall![1] as Record<string, unknown>).shas).toEqual(['a', 'b']);

    // Second call — same commits, still using module scope
    const queryFn = ctx.deps.backend.query as ReturnType<typeof vi.fn>;
    queryFn.mockClear();
    vi.mocked(gitReader.getRecentCommits).mockClear();
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(commits);

    await syncCommitDetails(ctx);

    // getMissingCommitShasV2 should NOT be called (all seen)
    const secondQueryCalls = queryFn.mock.calls;
    const secondMissingCall = secondQueryCalls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.shas !== undefined
    );
    expect(secondMissingCall).toBeUndefined();
  });
});
