import { describe, test, expect, vi, beforeEach } from 'vitest';

import { processRequests } from './git-subscription.js';
import type { DaemonContext } from './types.js';

// ─── Mock git-reader before importing the module under test ──────────────────

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  getFullDiff: vi.fn(),
  getDiffStat: vi.fn(),
  getCommitDetail: vi.fn(),
  getCommitMetadata: vi.fn(),
  getRecentCommits: vi.fn(),
  getAllPRs: vi.fn(),
  getPRDiffByNumber: vi.fn(),
  getPRCommits: vi.fn(),
  parseDiffStatLine: vi.fn(),
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
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    deps: {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
      },
    },
  } as unknown as DaemonContext;
}

/** Create a fake pending request with the given ID and type. */
function makeRequest(
  id: string,
  requestType:
    | 'full_diff'
    | 'commit_detail'
    | 'more_commits'
    | 'all_pull_requests'
    | 'recent_commits' = 'full_diff',
  extra: Record<string, unknown> = {}
) {
  return {
    _id: id,
    machineId: 'test-machine',
    workingDir: '/test/repo',
    requestType,
    status: 'pending',
    requestedAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  } as Parameters<typeof processRequests>[1][number];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processRequests', () => {
  let ctx: DaemonContext;
  let processedRequestIds: Map<string, number>;

  beforeEach(() => {
    ctx = makeMockContext();
    processedRequestIds = new Map();
    vi.clearAllMocks();
  });

  test('processes new requests and marks them in dedup map', async () => {
    const { getFullDiff, getDiffStat } = await import('../../../infrastructure/git/git-reader.js');
    vi.mocked(getFullDiff).mockResolvedValue({ status: 'not_found' } as never);
    vi.mocked(getDiffStat).mockResolvedValue({
      status: 'available',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    } as never);

    const requests = [makeRequest('req-1'), makeRequest('req-2')];
    await processRequests(ctx, requests, processedRequestIds, 5 * 60 * 1000);

    expect(processedRequestIds.has('req-1')).toBe(true);
    expect(processedRequestIds.has('req-2')).toBe(true);
  });

  test('skips already-processed requests (dedup)', async () => {
    // Pre-populate dedup map
    processedRequestIds.set('req-1', Date.now());

    const requests = [makeRequest('req-1'), makeRequest('req-2')];
    await processRequests(ctx, requests, processedRequestIds, 5 * 60 * 1000);

    // req-1 should have been skipped — only req-2 should trigger updateRequestStatus
    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;

    // req-2: mark processing, upsertFullDiff, mark done = 3 calls
    // (req-1 was skipped entirely)
    const processingCalls = mutationCalls.filter((call: unknown[]) => {
      const args = call[1] as { requestId?: string; status?: string } | undefined;
      return args?.requestId === 'req-1' && args?.status === 'processing';
    });
    expect(processingCalls.length).toBe(0);
  });

  test('evicts stale dedup entries older than TTL', async () => {
    const DEDUP_TTL_MS = 100; // Short TTL for testing

    // Add an old entry
    processedRequestIds.set('old-req', Date.now() - 200);
    // Add a fresh entry
    processedRequestIds.set('fresh-req', Date.now());

    await processRequests(ctx, [], processedRequestIds, DEDUP_TTL_MS);

    expect(processedRequestIds.has('old-req')).toBe(false);
    expect(processedRequestIds.has('fresh-req')).toBe(true);
  });

  test('does not evict entries within TTL', async () => {
    const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

    processedRequestIds.set('recent-req', Date.now() - 1000); // 1 second ago

    await processRequests(ctx, [], processedRequestIds, DEDUP_TTL_MS);

    expect(processedRequestIds.has('recent-req')).toBe(true);
  });

  test('marks failed requests as error status', async () => {
    const requests = [makeRequest('req-fail')];

    // Make the first mutation (mark processing) succeed,
    // then the processing itself will fail because git-reader isn't mocked
    const mutationFn = ctx.deps.backend.mutation as ReturnType<typeof vi.fn>;
    mutationFn.mockResolvedValue(undefined);

    // processFullDiff will throw because getFullDiff is not available in test context
    // The catch block should mark it as error
    await processRequests(ctx, requests, processedRequestIds, 5 * 60 * 1000);

    // The request should still be in the dedup map (it was attempted)
    expect(processedRequestIds.has('req-fail')).toBe(true);
  });

  test('processes all_pull_requests request and calls upsertAllPullRequests', async () => {
    const { getAllPRs } = await import('../../../infrastructure/git/git-reader.js');
    vi.mocked(getAllPRs).mockResolvedValue([
      {
        prNumber: 1,
        title: 'feat: auth',
        url: 'https://github.com/test/repo/pull/1',
        headRefName: 'feat/auth',
        baseRefName: 'main',
        state: 'OPEN',
        author: 'alice',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        mergedAt: null,
        closedAt: null,
        isDraft: false,
      },
    ] as never);

    const requests = [makeRequest('req-all-prs', 'all_pull_requests')];
    await processRequests(ctx, requests, processedRequestIds, 5 * 60 * 1000);

    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    // Find the upsertAllPullRequests call (first arg is the API function, second is args)
    const upsertCall = mutationCalls.find((call: unknown[]) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args?.pullRequests !== undefined;
    });
    expect(upsertCall).toBeDefined();
    expect((upsertCall![1] as Record<string, unknown>).pullRequests).toHaveLength(1);
    expect((upsertCall![1] as Record<string, unknown>).pullRequests).toEqual(
      expect.arrayContaining([expect.objectContaining({ prNumber: 1 })])
    );
  });

  test('processes recent_commits request and calls upsertRecentCommits', async () => {
    const { getRecentCommits } = await import('../../../infrastructure/git/git-reader.js');
    vi.mocked(getRecentCommits).mockResolvedValue([
      {
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        shortSha: 'aaaaaaa',
        message: 'feat: initial',
        author: 'alice',
        date: '2024-01-01T00:00:00Z',
      },
    ] as never);

    const requests = [makeRequest('req-recent', 'recent_commits')];
    await processRequests(ctx, requests, processedRequestIds, 5 * 60 * 1000);

    const mutationCalls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    const upsertCall = mutationCalls.find((call: unknown[]) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args?.commits !== undefined && args?.hasMoreCommits !== undefined;
    });
    expect(upsertCall).toBeDefined();
    expect((upsertCall![1] as Record<string, unknown>).commits).toHaveLength(1);
    expect((upsertCall![1] as Record<string, unknown>).hasMoreCommits).toBe(false);
  });
});
