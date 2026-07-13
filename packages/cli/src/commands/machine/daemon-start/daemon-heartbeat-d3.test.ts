/**
 * Daemon Heartbeat Effect Tests (Phase D3 → updated for E3)
 *
 * Tests for the Effect twins of heartbeat functions:
 *   pushGitStateEffect, pushSingleWorkspaceGitStateEffect,
 *   pushSingleWorkspaceGitSummaryForObservedEffect,
 *   syncCommitDetailsEffect,
 *   pushCommandsEffect, pushSingleWorkspaceCommandsEffect,
 *   fulfillFileContentRequestsEffect.
 *
 * All heartbeat Effect twins now require DaemonSessionService (migrated in E3).
 */

import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import type { DaemonMutableStateService, DaemonSessionService } from './daemon-services.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonSessionInit } from './types.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../api.js', () => ({
  api: {
    workspaces: {
      upsertWorkspaceGitState: 'mock-upsertWorkspaceGitState',
      upsertRecentCommits: 'mock-upsertRecentCommits',
      getMissingCommitShasV2: 'mock-getMissingCommitShasV2',
      upsertCommitDetailV2: 'mock-upsertCommitDetailV2',
    },
    commands: {
      syncCommands: 'mock-syncCommands',
    },
    workspaceFiles: {
      getPendingFileContentRequests: 'mock-getPendingFileContentRequests',
      fulfillFileContentV2: 'mock-fulfillFileContentV2',
    },
  },
}));

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(false),
  getBranch: vi.fn().mockResolvedValue({ status: 'not_found' }),
  isDirty: vi.fn().mockResolvedValue(false),
  getDiffStat: vi.fn().mockResolvedValue({ status: 'not_found' }),
  getRecentCommits: vi.fn().mockResolvedValue([]),
  getCommitsAhead: vi.fn().mockResolvedValue(0),
  getCommitsBehind: vi.fn().mockResolvedValue(0),
  getRemotes: vi.fn().mockResolvedValue([]),
  getOpenPRsForBranch: vi.fn().mockResolvedValue([]),
  getAllPRs: vi.fn().mockResolvedValue([]),
  getCommitStatusChecks: vi.fn().mockResolvedValue(null),
  getCommitDetail: vi.fn().mockResolvedValue({ status: 'not_found' }),
}));

vi.mock('./workspace-cache.js', () => ({
  getWorkspacesForMachine: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../infrastructure/services/workspace/command-discovery.js', () => ({
  discoverCommands: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test-convex-url',
}));

vi.mock('@workspace/backend/config/reliability.js', () => ({
  OBSERVED_FULL_PUSH_INTERVAL_MS: 60_000,
  NATIVE_DELIVERY_RECONCILE_MS: 10_000,
  HARNESS_SESSION_READY_TIMEOUT_MS: 5_000,
}));

// ---------------------------------------------------------------------------
// Helpers — DaemonSessionService layer
// ---------------------------------------------------------------------------

type HeartbeatEffectRequirements = DaemonSessionService | DaemonMutableStateService;

function makeSessionLayer(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<HeartbeatEffectRequirements> {
  const init = createMockDaemonSessionInit(overrides);
  return daemonSessionToLayers(init);
}

async function runWithCtx<A>(
  effect: Effect.Effect<A, never, HeartbeatEffectRequirements>,
  overrides?: Partial<DaemonSessionInit>
) {
  return Effect.runPromise(effect.pipe(Effect.provide(makeSessionLayer(overrides))));
}

/** Spread mock deps into flat DaemonSessionInit overrides. */
function withDeps(
  deps: ReturnType<typeof createMockDaemonDeps>,
  extra?: Partial<DaemonSessionInit>
): Partial<DaemonSessionInit> {
  return {
    backend: deps.backend,
    fs: deps.fs,
    machine: deps.machine,
    spawning: deps.spawning,
    agentProcessManager: deps.agentProcessManager,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// A. git-heartbeat Effect twins
// ---------------------------------------------------------------------------

describe('pushGitStateEffect', () => {
  it('completes without error when no workspaces are registered', async () => {
    const { pushGitStateEffect } = await import('./git-heartbeat.js');
    await expect(runWithCtx(pushGitStateEffect)).resolves.toBeUndefined();
  });

  it('reads machineId from DaemonSessionService', async () => {
    const { getWorkspacesForMachine } = await import('./workspace-cache.js');
    const { pushGitStateEffect } = await import('./git-heartbeat.js');

    const deps = createMockDaemonDeps();
    await runWithCtx(pushGitStateEffect, withDeps(deps, { machineId: 'machine-d3-git' }));

    expect(getWorkspacesForMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 'machine-d3-git' })
    );
  });
});

describe('pushSingleWorkspaceGitStateEffect', () => {
  it('calls upsertWorkspaceGitState with not_found when not a git repo', async () => {
    const { pushSingleWorkspaceGitStateEffect } = await import('./git-heartbeat.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runWithCtx(
      pushSingleWorkspaceGitStateEffect('/tmp/not-a-repo'),
      withDeps(deps, { machineId: 'machine-d3' })
    );

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'not_found', workingDir: '/tmp/not-a-repo' })
    );
  });

  it('uses sessionId from ctx when calling backend', async () => {
    const { pushSingleWorkspaceGitStateEffect } = await import('./git-heartbeat.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runWithCtx(
      pushSingleWorkspaceGitStateEffect('/tmp/repo'),
      withDeps(deps, { sessionId: 'session-d3' })
    );

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-d3' })
    );
  });
});

describe('pushSingleWorkspaceGitSummaryForObservedEffect', () => {
  it('completes without error when workspace is not a git repo', async () => {
    const { pushSingleWorkspaceGitSummaryForObservedEffect } = await import('./git-heartbeat.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await expect(
      runWithCtx(pushSingleWorkspaceGitSummaryForObservedEffect('/tmp/not-a-repo'), withDeps(deps))
    ).resolves.toBeUndefined();
  });

  it('forwards the reason argument when provided', async () => {
    const gitReader = await import('../../../infrastructure/git/git-reader.js');
    const { pushSingleWorkspaceGitSummaryForObservedEffect } = await import('./git-heartbeat.js');

    vi.mocked(gitReader.isGitRepo).mockResolvedValue(false);
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    // refresh reason forces push even if hash matches — just verify it resolves cleanly
    await expect(
      runWithCtx(
        pushSingleWorkspaceGitSummaryForObservedEffect('/tmp/repo', 'refresh'),
        withDeps(deps)
      )
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// B. commit-detail-sync Effect twin
// ---------------------------------------------------------------------------

describe('syncCommitDetailsEffect', () => {
  it('completes without error when no workspaces are registered', async () => {
    const { syncCommitDetailsEffect } = await import('./commit-detail-sync.js');
    await expect(runWithCtx(syncCommitDetailsEffect())).resolves.toBeUndefined();
  });

  it('passes machineId from session to getWorkspacesForMachine', async () => {
    const { getWorkspacesForMachine } = await import('./workspace-cache.js');
    const { syncCommitDetailsEffect } = await import('./commit-detail-sync.js');

    await runWithCtx(syncCommitDetailsEffect(), { machineId: 'machine-commit-d3' });

    expect(getWorkspacesForMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 'machine-commit-d3' })
    );
  });

  it('accepts an optional seenShasMap injection', async () => {
    const { syncCommitDetailsEffect } = await import('./commit-detail-sync.js');
    const injectedMap = new Map<string, Set<string>>();

    // Should resolve without error with custom map
    await expect(runWithCtx(syncCommitDetailsEffect(injectedMap))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C. command-sync-heartbeat Effect twins
// ---------------------------------------------------------------------------

describe('pushCommandsEffect', () => {
  it('completes without error when no workspaces are registered', async () => {
    const { pushCommandsEffect } = await import('./command-sync-heartbeat.js');
    await expect(runWithCtx(pushCommandsEffect)).resolves.toBeUndefined();
  });

  it('passes machineId from session to getWorkspacesForMachine', async () => {
    const { getWorkspacesForMachine } = await import('./workspace-cache.js');
    const { pushCommandsEffect } = await import('./command-sync-heartbeat.js');

    await runWithCtx(pushCommandsEffect, { machineId: 'machine-cmds-d3' });

    expect(getWorkspacesForMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 'machine-cmds-d3' })
    );
  });
});

describe('pushSingleWorkspaceCommandsEffect', () => {
  it('calls discoverCommands for the given workingDir', async () => {
    const { discoverCommands } =
      await import('../../../infrastructure/services/workspace/command-discovery.js');
    const { pushSingleWorkspaceCommandsEffect } = await import('./command-sync-heartbeat.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runWithCtx(pushSingleWorkspaceCommandsEffect('/tmp/workspace'), withDeps(deps));

    expect(discoverCommands).toHaveBeenCalledWith('/tmp/workspace');
  });

  it('calls syncCommands mutation with sessionId and machineId from session', async () => {
    const { pushSingleWorkspaceCommandsEffect } = await import('./command-sync-heartbeat.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runWithCtx(
      pushSingleWorkspaceCommandsEffect('/tmp/ws'),
      withDeps(deps, { sessionId: 'session-cmds', machineId: 'machine-cmds' })
    );

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-cmds', machineId: 'machine-cmds' })
    );
  });
});

// ---------------------------------------------------------------------------
// D. file-content-fulfillment Effect twin
// ---------------------------------------------------------------------------

describe('fulfillFileContentRequestsEffect', () => {
  it('completes without error when no pending requests exist', async () => {
    const { fulfillFileContentRequestsEffect } = await import('./file-content-fulfillment.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockResolvedValue([]);

    await expect(
      runWithCtx(fulfillFileContentRequestsEffect, withDeps(deps))
    ).resolves.toBeUndefined();
  });

  it('passes sessionId and machineId from session when querying pending requests', async () => {
    const { fulfillFileContentRequestsEffect } = await import('./file-content-fulfillment.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockResolvedValue([]);

    await runWithCtx(
      fulfillFileContentRequestsEffect,
      withDeps(deps, { sessionId: 'session-file', machineId: 'machine-file' })
    );

    expect(deps.backend.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-file', machineId: 'machine-file' })
    );
  });
});
