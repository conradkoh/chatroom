/**
 * Daemon Handler Effect Tests (Phase D2)
 *
 * Tests for the Effect twins of orphan-tracker and command-runner handlers:
 *   reapOrphanedProcessGroupsEffect, forceKillAllTrackedProcessGroupsEffect,
 *   clearTrackedPidsEffect, onCommandRunEffect, onCommandStopEffect,
 *   forceKillAllCommandsEffect.
 *
 * Orphan-tracker effects have no service dependencies.
 * Command-runner effects (E5.1) now yield DaemonSessionService.
 */

import type { Layer } from 'effect';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from '../daemon-layers.js';
import type { DaemonSessionService } from '../daemon-services.js';
import { createMockDaemonSessionInit } from '../testing/index.js';
import { createMockDaemonDeps } from '../testing/mock-daemon-deps.js';
import type { DaemonSessionInit } from '../types.js';
import {
  forceKillAllCommandsEffect,
  onCommandRunEffect,
  onCommandStopEffect,
} from './command-runner.js';
import {
  clearTrackedPidsEffect,
  forceKillAllTrackedProcessGroupsEffect,
  reapOrphanedProcessGroupsEffect,
} from './orphan-tracker.js';
import { processManager } from './process/manager.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../api.js', () => ({
  api: {
    commands: {
      updateRunStatus: 'mock-updateRunStatus',
      appendOutput: 'mock-appendOutput',
      updateRunTailV2: 'mock-updateRunTailV2',
      getRunStatus: 'mock-getRunStatus',
    },
  },
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./process/output-store.js', () => ({
  createOutputStore: vi.fn(() => ({
    append: vi.fn().mockResolvedValue(undefined),
    getTail: vi.fn().mockReturnValue({ content: '', totalBytes: 0 }),
    getFullOutput: vi.fn().mockResolvedValue(''),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
  ensureTempDir: vi.fn().mockResolvedValue(undefined),
  cleanOrphanTempFiles: vi.fn().mockResolvedValue(undefined),
  TAIL_WINDOW_BYTES: 32 * 1024,
}));

vi.mock('@workspace/backend/src/output-encoding.js', () => ({
  encodeOutput: vi.fn((plain: string) => ({
    compression: 'gzip',
    content: `gzip:${plain}`,
  })),
}));

vi.mock('../../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test-convex-url',
}));

// ---------------------------------------------------------------------------
// Helpers — DaemonSessionService (for command-runner Effect twins, E5.1)
// ---------------------------------------------------------------------------

function makeSessionLayer(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<DaemonSessionService> {
  const init = createMockDaemonSessionInit(overrides);
  return daemonSessionToLayers(init);
}

async function runWithSession<A>(
  effect: Effect.Effect<A, never, DaemonSessionService>,
  overrides?: Partial<DaemonSessionInit>
) {
  return Effect.runPromise(effect.pipe(Effect.provide(makeSessionLayer(overrides))));
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  processManager.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  processManager.clear();
});

// ---------------------------------------------------------------------------
// A. orphan-tracker Effect twins (no service dependencies required)
// ---------------------------------------------------------------------------

describe('reapOrphanedProcessGroupsEffect', () => {
  it('resolves with { reaped: 0, checked: 0 } when no pids file exists', async () => {
    const result = await Effect.runPromise(reapOrphanedProcessGroupsEffect);
    expect(result).toEqual({ reaped: 0, checked: 0 });
  });

  it('result has numeric reaped and checked fields', async () => {
    const result = await Effect.runPromise(reapOrphanedProcessGroupsEffect);
    expect(typeof result.reaped).toBe('number');
    expect(typeof result.checked).toBe('number');
  });
});

describe('forceKillAllTrackedProcessGroupsEffect', () => {
  it('returns 0 when no process groups are tracked', async () => {
    const result = await Effect.runPromise(forceKillAllTrackedProcessGroupsEffect);
    expect(result).toBe(0);
  });
});

describe('clearTrackedPidsEffect', () => {
  it('completes without error when no pids file exists', async () => {
    await expect(Effect.runPromise(clearTrackedPidsEffect)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// B. command-runner Effect twins (E5.1 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('forceKillAllCommandsEffect', () => {
  it('completes without error when no processes are running', async () => {
    await expect(Effect.runPromise(forceKillAllCommandsEffect)).resolves.toBeUndefined();
  });
});

describe('onCommandStopEffect', () => {
  it('marks pending stop and calls backend.mutation when no process is tracked', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runWithSession(onCommandStopEffect({ runId: 'd2-stop-test-1' as any }), {
      backend: deps.backend,
      fs: deps.fs,
      machine: deps.machine,
      spawning: deps.spawning,
      agentProcessManager: deps.agentProcessManager,
      machineId: 'test-machine-d2',
    });

    expect(processManager.hasPendingStop('d2-stop-test-1')).toBe(true);
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ machineId: 'test-machine-d2', status: 'stopped' })
    );
  });

  it('uses sessionId from ctx when calling backend.mutation', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    await runWithSession(onCommandStopEffect({ runId: 'd2-stop-test-2' as any }), {
      backend: deps.backend,
      fs: deps.fs,
      machine: deps.machine,
      spawning: deps.spawning,
      agentProcessManager: deps.agentProcessManager,
      sessionId: 'custom-session-id' as any,
    });

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'custom-session-id', status: 'stopped' })
    );
  });
});

describe('onCommandRunEffect', () => {
  it('skips spawn and calls backend.mutation(stopped) when a pending stop exists', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    vi.mocked(deps.backend.query).mockResolvedValue(undefined);

    // Pre-register a pending stop so onCommandRun takes the early-exit path (no spawn)
    processManager.markPendingStop('d2-run-test-1');

    await runWithSession(
      onCommandRunEffect({
        workingDir: '/tmp',
        commandName: 'test-cmd',
        script: 'echo hello',
        runId: 'd2-run-test-1' as any,
      }),
      {
        backend: deps.backend,
        fs: deps.fs,
        machine: deps.machine,
        spawning: deps.spawning,
        agentProcessManager: deps.agentProcessManager,
        machineId: 'test-machine-d2',
      }
    );

    // Should NOT be registered in processManager (no spawn occurred)
    expect(processManager.has('d2-run-test-1')).toBe(false);
    // Backend should have been called with stopped status
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'stopped' })
    );
  });

  it('uses machineId from ctx when calling backend.mutation', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    vi.mocked(deps.backend.query).mockResolvedValue(undefined);

    processManager.markPendingStop('d2-run-test-2');

    await runWithSession(
      onCommandRunEffect({
        workingDir: '/tmp',
        commandName: 'check-machine-id',
        script: 'echo hello',
        runId: 'd2-run-test-2' as any,
      }),
      {
        backend: deps.backend,
        fs: deps.fs,
        machine: deps.machine,
        spawning: deps.spawning,
        agentProcessManager: deps.agentProcessManager,
        machineId: 'machine-from-ctx',
      }
    );

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ machineId: 'machine-from-ctx' })
    );
  });
});
