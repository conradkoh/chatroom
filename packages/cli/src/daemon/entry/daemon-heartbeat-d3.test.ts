/**
 * Daemon Effect Tests (Phase D3 → updated for E3, S5a)
 *
 * Tests for fulfillFileContentRequestsEffect. The git and command heartbeat twins were removed
 * with their modules; WorkspaceService owns workspace state sync now.
 */

import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import type { DaemonMutableStateService, DaemonSessionService } from './daemon-services.js';
import type { DaemonSessionInit } from './daemon-types.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../api.js', () => ({
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

vi.mock('../infrastructure/git/git-reader.js', () => ({
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

vi.mock('../../infrastructure/services/workspace/command-discovery.js', () => ({
  discoverCommands: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test-convex-url',
}));

vi.mock('@workspace/backend/config/reliability.js', () => ({
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
// D. file-content-fulfillment Effect twin
// ---------------------------------------------------------------------------

describe('fulfillFileContentRequestsEffect', () => {
  it('completes without error when no pending requests exist', async () => {
    const { fulfillFileContentRequestsEffect } =
      await import('./files/file-content-fulfillment.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockResolvedValue([]);

    await expect(
      runWithCtx(fulfillFileContentRequestsEffect, withDeps(deps))
    ).resolves.toBeUndefined();
  });

  it('passes sessionId and machineId from session when querying pending requests', async () => {
    const { fulfillFileContentRequestsEffect } =
      await import('./files/file-content-fulfillment.js');
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
