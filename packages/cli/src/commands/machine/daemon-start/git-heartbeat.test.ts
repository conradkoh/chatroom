import { describe, test, expect, vi, beforeEach } from 'vitest';

import { pushSingleWorkspaceGitSummaryForObserved } from './git-heartbeat.js';
import type { DaemonContext } from './types.js';

// ─── Mock git-reader before importing the module under test ──────────────────

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  isGitRepo: vi.fn(),
  getBranch: vi.fn(),
  isDirty: vi.fn(),
  getDiffStat: vi.fn(),
  getRecentCommits: vi.fn(),
  getCommitsAhead: vi.fn(),
  getRemotes: vi.fn(),
  getOpenPRsForBranch: vi.fn(),
  getAllPRs: vi.fn(),
  getCommitStatusChecks: vi.fn(),
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a minimal mock DaemonContext with spied backend methods. */
function makeMockContext(): DaemonContext {
  return {
    client: null,
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null,
    events: {} as DaemonContext['events'],
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    deps: {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
      },
    },
  } as unknown as DaemonContext;
}

const WORKING_DIR = '/test/repo';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('pushSingleWorkspaceGitSummaryForObserved', () => {
  let ctx: DaemonContext;

  beforeEach(() => {
    ctx = makeMockContext();
    vi.clearAllMocks();
  });

  test('pushes slim summary and skips heavy metadata calls', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');

    vi.mocked(gitReader.isGitRepo).mockResolvedValue(true);
    vi.mocked(gitReader.getBranch).mockResolvedValue({ status: 'available', branch: 'main' });
    vi.mocked(gitReader.isDirty).mockResolvedValue(false);
    vi.mocked(gitReader.getOpenPRsForBranch).mockResolvedValue([
      {
        prNumber: 42,
        title: 'feat: auth',
        url: 'https://github.com/test/repo/pull/42',
        headRefName: 'feat/auth',
        state: 'OPEN',
      },
    ]);
    vi.mocked(gitReader.getCommitStatusChecks).mockResolvedValue({
      state: 'success',
      checkRuns: [],
      totalCount: 0,
    });

    await pushSingleWorkspaceGitSummaryForObserved(ctx, WORKING_DIR);

    // Cheap eager fields MUST be fetched
    expect(gitReader.getBranch).toHaveBeenCalledWith(WORKING_DIR);
    expect(gitReader.isDirty).toHaveBeenCalledWith(WORKING_DIR);
    expect(gitReader.getOpenPRsForBranch).toHaveBeenCalledWith(WORKING_DIR, 'main');
    expect(gitReader.getCommitStatusChecks).toHaveBeenCalledWith(WORKING_DIR, 'main');

    // Heavy metadata MUST NOT be fetched
    expect(gitReader.getDiffStat).not.toHaveBeenCalled();
    expect(gitReader.getRecentCommits).not.toHaveBeenCalled();
    expect(gitReader.getCommitsAhead).not.toHaveBeenCalled();
    expect(gitReader.getRemotes).not.toHaveBeenCalled();
    expect(gitReader.getAllPRs).not.toHaveBeenCalled();

    // Backend mutation should only include eager fields
    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    const upsertCall = mutationCalls.find((call: unknown[]) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args?.status === 'available';
    });
    expect(upsertCall).toBeDefined();

    const args = upsertCall![1] as Record<string, unknown>;
    expect(args.branch).toBe('main');
    expect(args.isDirty).toBe(false);
    expect(args.openPullRequests).toHaveLength(1);
    expect(args.headCommitStatus).toBeDefined();

    // Heavy fields must NOT be present
    expect(args.diffStat).toBeUndefined();
    expect(args.recentCommits).toBeUndefined();
    expect(args.hasMoreCommits).toBeUndefined();
    expect(args.remotes).toBeUndefined();
    expect(args.commitsAhead).toBeUndefined();
    expect(args.allPullRequests).toBeUndefined();
  });

  test('skips push when state has not changed', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');

    vi.mocked(gitReader.isGitRepo).mockResolvedValue(true);
    vi.mocked(gitReader.getBranch).mockResolvedValue({ status: 'available', branch: 'main' });
    vi.mocked(gitReader.isDirty).mockResolvedValue(false);
    vi.mocked(gitReader.getOpenPRsForBranch).mockResolvedValue([]);
    vi.mocked(gitReader.getCommitStatusChecks).mockResolvedValue(null);

    // First push
    await pushSingleWorkspaceGitSummaryForObserved(ctx, WORKING_DIR);
    const firstCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.length;

    // Second push with same state — should skip
    await pushSingleWorkspaceGitSummaryForObserved(ctx, WORKING_DIR);
    const secondCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(secondCalls).toBe(firstCalls); // No additional mutation calls
  });

  test('pushes not_found when not a git repo', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');
    vi.mocked(gitReader.isGitRepo).mockResolvedValue(false);

    await pushSingleWorkspaceGitSummaryForObserved(ctx, WORKING_DIR);

    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    const upsertCall = mutationCalls.find((call: unknown[]) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args?.status === 'not_found';
    });
    expect(upsertCall).toBeDefined();
  });

  test('pushes error when branch fetch fails', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');
    vi.mocked(gitReader.isGitRepo).mockResolvedValue(true);
    vi.mocked(gitReader.getBranch).mockResolvedValue({
      status: 'error',
      message: 'git not available',
    });

    await pushSingleWorkspaceGitSummaryForObserved(ctx, WORKING_DIR);

    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    const upsertCall = mutationCalls.find((call: unknown[]) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args?.status === 'error';
    });
    expect(upsertCall).toBeDefined();
    expect((upsertCall![1] as Record<string, unknown>).errorMessage).toBe('git not available');
  });
});
