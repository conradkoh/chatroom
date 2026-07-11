import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import {
  DaemonSessionService,
  type DaemonMutableStateService,
  type DaemonSessionServiceShape,
} from './daemon-services.js';
import {
  _resetGitHeartbeatBranchTrackingForTests,
  pushSingleWorkspaceGitSummaryForObservedEffect,
} from './git-heartbeat.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonSessionInit } from './types.js';
import { makeGitStateKey } from '../../../infrastructure/git/types.js';

vi.mock('@workspace/backend/config/reliability.js', () => ({
  OBSERVED_FULL_PUSH_INTERVAL_MS: 300_000,
}));

const mockGetBranch = vi.fn();

vi.mock('../../../api.js', () => ({
  api: {
    workspaces: {
      upsertWorkspaceGitState: 'mock-upsertWorkspaceGitState',
      upsertRecentCommits: 'mock-upsertRecentCommits',
    },
  },
}));

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(true),
  getBranch: (...args: unknown[]) => mockGetBranch(...args),
  isDirty: vi.fn().mockResolvedValue(false),
  getDiffStat: vi.fn().mockResolvedValue({
    status: 'available',
    diffStat: { filesChanged: 2, insertions: 10, deletions: 1 },
  }),
  getCommitsAhead: vi.fn().mockResolvedValue(0),
  getCommitsBehind: vi.fn().mockResolvedValue(0),
  getRemotes: vi.fn().mockResolvedValue([]),
  getAllPRs: vi.fn().mockResolvedValue([]),
  getOpenPRsForBranch: vi.fn().mockResolvedValue([]),
  getCommitStatusChecks: vi.fn().mockResolvedValue(null),
  getRecentCommits: vi.fn().mockResolvedValue([]),
}));

const MACHINE_ID = 'machine-git';
const WORKING_DIR = '/workspace';

type GitHeartbeatRequirements = DaemonSessionService | DaemonMutableStateService;

function makeSessionLayer(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<GitHeartbeatRequirements> {
  const init = createMockDaemonSessionInit(overrides);
  return daemonSessionToLayers(init);
}

async function runGitHeartbeatEffect(
  effect: Effect.Effect<void, never, GitHeartbeatRequirements>,
  overrides?: Partial<DaemonSessionInit>
) {
  const layer = makeSessionLayer(overrides);
  return Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<GitHeartbeatRequirements>();
      const session = yield* DaemonSessionService;
      const sessionWithRuntime = { ...session, runtime };
      return yield* effect.pipe(
        Effect.provideService(DaemonSessionService, sessionWithRuntime as DaemonSessionServiceShape)
      );
    }).pipe(Effect.provide(layer))
  );
}

function gitStateMutationArgs(
  mutation: ReturnType<typeof vi.fn>
): Record<string, unknown> | undefined {
  const call = vi
    .mocked(mutation)
    .mock.calls.find((entry) => entry[0] === 'mock-upsertWorkspaceGitState');
  return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  _resetGitHeartbeatBranchTrackingForTests();
  mockGetBranch.mockResolvedValue({ status: 'available', branch: 'main' });
});

describe('pushSingleWorkspaceGitSummaryForObservedEffect', () => {
  it('uses full push when reason is refresh even within the full-push window', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runGitHeartbeatEffect(
      pushSingleWorkspaceGitSummaryForObservedEffect(WORKING_DIR, 'safety-poll'),
      { backend: deps.backend, machineId: MACHINE_ID }
    );

    await runGitHeartbeatEffect(
      pushSingleWorkspaceGitSummaryForObservedEffect(WORKING_DIR, 'refresh'),
      { backend: deps.backend, machineId: MACHINE_ID }
    );

    const refreshArgs = gitStateMutationArgs(vi.mocked(deps.backend.mutation));
    expect(refreshArgs?.pipelineMode).toBe('full');
    expect(refreshArgs?.diffStat).toEqual({
      filesChanged: 2,
      insertions: 10,
      deletions: 1,
    });
  });

  it('uses slim push when branch is unchanged and within the full-push window', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runGitHeartbeatEffect(
      pushSingleWorkspaceGitSummaryForObservedEffect(WORKING_DIR, 'safety-poll'),
      { backend: deps.backend, machineId: MACHINE_ID }
    );

    vi.mocked(deps.backend.mutation).mockClear();

    await runGitHeartbeatEffect(
      pushSingleWorkspaceGitSummaryForObservedEffect(WORKING_DIR, 'safety-poll'),
      { backend: deps.backend, machineId: MACHINE_ID }
    );

    const slimArgs = gitStateMutationArgs(vi.mocked(deps.backend.mutation));
    expect(slimArgs?.pipelineMode).toBe('slim');
    expect(slimArgs?.diffStat).toBeUndefined();
  });

  it('uses full push when branch changes from the last pushed branch', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runGitHeartbeatEffect(
      pushSingleWorkspaceGitSummaryForObservedEffect(WORKING_DIR, 'safety-poll'),
      { backend: deps.backend, machineId: MACHINE_ID }
    );

    mockGetBranch.mockResolvedValue({ status: 'available', branch: 'feat/x' });
    vi.mocked(deps.backend.mutation).mockClear();

    await runGitHeartbeatEffect(
      pushSingleWorkspaceGitSummaryForObservedEffect(WORKING_DIR, 'safety-poll'),
      { backend: deps.backend, machineId: MACHINE_ID }
    );

    const branchChangeArgs = gitStateMutationArgs(vi.mocked(deps.backend.mutation));
    expect(branchChangeArgs?.pipelineMode).toBe('full');
    expect(branchChangeArgs?.diffStat).toBeDefined();
    expect(makeGitStateKey(MACHINE_ID, WORKING_DIR)).toBeTruthy();
  });
});
