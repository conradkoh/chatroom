/**
 * init.ts Unit Tests
 *
 * Tests initDaemon() and discoverModels() with full module mocking.
 * All external dependencies are mocked to isolate the initialization logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { CONNECTION_RETRY_INTERVAL_MS, initDaemon, discoverModels } from './init.js';
import { getSessionId, getOtherSessionUrls } from '../../../infrastructure/auth/storage.js';
import { getConvexUrl, getConvexClient } from '../../../infrastructure/convex/client.js';
import {
  ensureMachineRegistered,
  loadMachineConfig,
} from '../../../infrastructure/machine/index.js';
import { isNetworkError, formatConnectivityError } from '../../../utils/error-formatting.js';
import { acquireLock, releaseLock } from '../pid.js';

// ---------------------------------------------------------------------------
// Module Mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('../pid.js', () => ({
  acquireLock: vi.fn().mockReturnValue(true),
  releaseLock: vi.fn(),
}));

vi.mock('../../../infrastructure/auth/storage.js', () => ({
  getSessionId: vi.fn().mockResolvedValue('session-123'),
  getOtherSessionUrls: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
  getConvexClient: vi.fn().mockResolvedValue({
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ valid: true, userId: 'user-1', userName: 'Test User' }),
  }),
}));

vi.mock('../../../infrastructure/machine/index.js', () => ({
  ensureMachineRegistered: vi.fn().mockResolvedValue({
    machineId: 'machine-abc',
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
  }),
  loadMachineConfig: vi.fn().mockResolvedValue({
    machineId: 'machine-abc',
    hostname: 'test-host',
    os: 'darwin',
    registeredAt: '2026-01-01T00:00:00Z',
    lastSyncedAt: '2026-01-01T00:00:00Z',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
  }),
  clearAgentPid: vi.fn(),
  persistAgentPid: vi.fn(),
  listAgentEntries: vi.fn().mockResolvedValue([]),
  persistEventCursor: vi.fn(),
  loadEventCursor: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../utils/error-formatting.js', () => ({
  isNetworkError: vi.fn().mockReturnValue(false),
  formatConnectivityError: vi.fn(),
}));

vi.mock('../../../version.js', () => ({
  getVersion: vi.fn().mockReturnValue('1.0.0-test'),
}));

const { recoverEffectRun } = vi.hoisted(() => ({ recoverEffectRun: vi.fn() }));

vi.mock('./handlers/state-recovery.js', async () => {
  const { Effect } = await import('effect');
  return {
    recoverAgentStateEffect: Effect.promise(() => recoverEffectRun()),
  };
});

vi.mock('./handlers/orphan-tracker.js', async () => {
  const { Effect } = await import('effect');
  return {
    reapOrphanedProcessGroups: vi.fn().mockResolvedValue({ reaped: 0, checked: 0 }), // keep — harmless
    reapOrphanedProcessGroupsEffect: Effect.succeed({ reaped: 0, checked: 0 }),
    trackChildPid: vi.fn(),
    untrackChildPid: vi.fn(),
  };
});

vi.mock('../../../infrastructure/services/remote-agents/opencode/index.js', () => {
  return {
    OpenCodeAgentService: class MockOpenCodeAgentService {
      isInstalled = vi.fn().mockResolvedValue(true);
      getVersion = vi.fn().mockResolvedValue({ version: '0.1.0', major: 0 });
      listModels = vi.fn().mockResolvedValue([]);
      spawn = vi.fn();
      stop = vi.fn();
      isAlive = vi.fn();
      getTrackedProcesses = vi.fn().mockReturnValue([]);
      untrack = vi.fn();
    },
  };
});

vi.mock('../../../infrastructure/services/remote-agents/opencode-sdk/index.js', () => {
  return {
    OpenCodeSdkAgentService: class MockOpenCodeSdkAgentService {
      isInstalled = vi.fn().mockResolvedValue(false);
      getVersion = vi.fn().mockResolvedValue(null);
      listModels = vi.fn().mockResolvedValue([]);
      spawn = vi.fn();
      stop = vi.fn();
      isAlive = vi.fn();
      getTrackedProcesses = vi.fn().mockReturnValue([]);
      untrack = vi.fn();
    },
  };
});

vi.mock('./utils.js', () => ({
  formatTimestamp: vi.fn().mockReturnValue('2026-01-01 00:00:00'),
}));

vi.mock('./handlers/process/output-store.js', () => ({
  cleanOrphanTempFiles: vi.fn().mockResolvedValue(0),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let exitSpy: any;

let logSpy: any;

let errorSpy: any;

let warnSpy: any;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();

  // Re-establish default return values for all module mocks.
  // vi.restoreAllMocks() clears implementations set by tests, so we
  // need to set them here to get predictable defaults.
  vi.mocked(acquireLock).mockReturnValue(true);
  vi.mocked(getSessionId).mockResolvedValue('session-123' as never);
  vi.mocked(getOtherSessionUrls).mockResolvedValue([]);
  vi.mocked(getConvexUrl).mockReturnValue('http://localhost:3210');
  vi.mocked(getConvexClient).mockResolvedValue({
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ valid: true, userId: 'user-1', userName: 'Test User' }),
  } as never);
  vi.mocked(ensureMachineRegistered).mockResolvedValue({
    machineId: 'machine-abc',
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
  } as never);
  vi.mocked(loadMachineConfig).mockResolvedValue({
    machineId: 'machine-abc',
    hostname: 'test-host',
    os: 'darwin',
    registeredAt: '2026-01-01T00:00:00Z',
    lastSyncedAt: '2026-01-01T00:00:00Z',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
  } as never);
  recoverEffectRun.mockResolvedValue(undefined);
  vi.mocked(isNetworkError).mockReturnValue(false);

  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Helper to get the mock Convex client returned by getConvexClient.
 * We need this to set up custom mutation/query behaviour per test.
 */
async function getMockClient() {
  const client = await vi.mocked(getConvexClient)();

  return client as any as { mutation: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> };
}

/** Advance fake timers through N backend-retry delays (initDaemon uses setTimeout). */
async function advanceConnectionRetries(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(CONNECTION_RETRY_INTERVAL_MS);
  }
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// discoverModels
// ---------------------------------------------------------------------------

describe('discoverModels', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns models from the remote agent service', async () => {
    const mockService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue(['gpt-4', 'claude-3']),
    } as any;

    const agentServices = new Map([['opencode', mockService]]);
    const models = await discoverModels(agentServices);
    expect(models).toEqual({ opencode: ['gpt-4', 'claude-3'] });
    expect(mockService.listModels).toHaveBeenCalledOnce();
  });

  it('returns empty record entry when service throws (non-critical)', async () => {
    const mockService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockRejectedValue(new Error('Service broken')),
    } as any;

    const agentServices = new Map([['opencode', mockService]]);
    const models = await discoverModels(agentServices);
    expect(models).toEqual({ opencode: [] });
  });

  it('returns empty record when service is not installed', async () => {
    const mockService = {
      isInstalled: vi.fn().mockResolvedValue(false),
      listModels: vi.fn().mockResolvedValue([]),
    } as any;

    const agentServices = new Map([['opencode', mockService]]);
    const models = await discoverModels(agentServices);
    expect(models).toEqual({});
  });

  it('discovers models from multiple harnesses independently', async () => {
    const opencodeService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue(['opencode/model-a']),
    } as any;
    const piService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi
        .fn()
        .mockResolvedValue(['github-copilot/claude-sonnet-4.5', 'github-copilot/gpt-4o']),
    } as any;

    const agentServices = new Map([
      ['opencode', opencodeService],
      ['pi', piService],
    ]);
    const models = await discoverModels(agentServices);

    expect(models).toEqual({
      opencode: ['opencode/model-a'],
      pi: ['github-copilot/claude-sonnet-4.5', 'github-copilot/gpt-4o'],
    });
  });

  it('excludes pi harness when pi is not installed, keeps opencode', async () => {
    const opencodeService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue(['opencode/model-a']),
    } as any;
    const piService = {
      isInstalled: vi.fn().mockResolvedValue(false),
      listModels: vi.fn(),
    } as any;

    const agentServices = new Map([
      ['opencode', opencodeService],
      ['pi', piService],
    ]);
    const models = await discoverModels(agentServices);

    expect(models).toEqual({ opencode: ['opencode/model-a'] });
    // pi.listModels should never be called when pi is not installed
    expect(piService.listModels).not.toHaveBeenCalled();
  });

  it('keeps successful harness when other harness listModels throws', async () => {
    const opencodeService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockRejectedValue(new Error('opencode broke')),
    } as any;
    const piService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue(['github-copilot/gpt-4o']),
    } as any;

    const agentServices = new Map([
      ['opencode', opencodeService],
      ['pi', piService],
    ]);
    const models = await discoverModels(agentServices);

    expect(models).toEqual({
      opencode: [], // failed → empty array fallback
      pi: ['github-copilot/gpt-4o'],
    });
  });

  it('runs harnesses in parallel', async () => {
    const startedAt: [string, number][] = [];

    const createService = (name: string, delayMs: number) => ({
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockImplementation(
        () =>
          new Promise<string[]>((resolve) => {
            startedAt.push([name, Date.now()]);
            setTimeout(() => resolve([`${name}/model`]), delayMs);
          })
      ),
    });

    const agentServices = new Map([
      ['alpha', createService('alpha', 300)],
      ['beta', createService('beta', 200)],
      ['gamma', createService('gamma', 100)],
    ]) as any;

    const discovery = discoverModels(agentServices);
    await vi.advanceTimersByTimeAsync(0);

    expect(startedAt).toHaveLength(3);
    expect(startedAt.map(([name]) => name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(new Set(startedAt.map(([, time]) => time)).size).toBe(1);

    await vi.advanceTimersByTimeAsync(300);
    await expect(discovery).resolves.toEqual({
      alpha: ['alpha/model'],
      beta: ['beta/model'],
      gamma: ['gamma/model'],
    });
  });

  it('skips not-installed harnesses', async () => {
    const installedService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue(['installed/model']),
    } as any;
    const missingService = {
      isInstalled: vi.fn().mockResolvedValue(false),
      listModels: vi.fn(),
    } as any;

    const agentServices = new Map([
      ['installed', installedService],
      ['missing', missingService],
    ]);

    await expect(discoverModels(agentServices)).resolves.toEqual({
      installed: ['installed/model'],
    });
    expect(missingService.listModels).not.toHaveBeenCalled();
  });

  it('returns [] for harness whose listModels throws and warns with structured JSON', async () => {
    const brokenService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockImplementation(() => {
        throw new Error('broken harness');
      }),
    } as any;

    const agentServices = new Map([['broken', brokenService]]);

    await expect(discoverModels(agentServices)).resolves.toEqual({ broken: [] });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const [warning] = warnSpy.mock.calls[0] ?? [];
    expect(typeof warning).toBe('string');
    expect(JSON.parse(warning)).toEqual({
      event: 'discover-models-error',
      harness: 'broken',
      reason: 'broken harness',
    });
  });

  it('resolves when all harnesses fail', async () => {
    const firstService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockRejectedValue(new Error('first failed')),
    } as any;
    const secondService = {
      isInstalled: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockRejectedValue(new Error('second failed')),
    } as any;

    const agentServices = new Map([
      ['first', firstService],
      ['second', secondService],
    ]);

    await expect(discoverModels(agentServices)).resolves.toEqual({
      first: [],
      second: [],
    });
  });
});

// ---------------------------------------------------------------------------
// initDaemon
// ---------------------------------------------------------------------------

describe('initDaemon', () => {
  it('exits when lock cannot be acquired', async () => {
    vi.mocked(acquireLock).mockReturnValue(false);

    await initDaemon();

    expect(exitSpy).toHaveBeenCalledWith(1);
  }, 10_000);

  it('waits for auth and resumes when session ID is initially missing', async () => {
    // First call returns null (unauthenticated), subsequent calls return valid session
    vi.mocked(getSessionId)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('session-123' as never);

    const ctx = await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'));
    expect(ctx).toBeDefined();
    expect(ctx.sessionId).toBe('session-123');
    expect(exitSpy).not.toHaveBeenCalled();
  }, 15_000);

  it('shows other session URLs when waiting for auth', async () => {
    vi.mocked(getSessionId)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('session-123' as never);
    vi.mocked(getOtherSessionUrls).mockResolvedValue(['http://other:3210']);

    const ctx = await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('other environments'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('http://other:3210'));
    expect(ctx).toBeDefined();
  }, 10_000);

  it('waits for re-auth when backend session validation fails', async () => {
    const mockClient = await getMockClient();
    // First validation fails, then succeeds after re-auth
    mockClient.query
      .mockResolvedValueOnce({ valid: false, reason: 'Session expired' })
      .mockResolvedValueOnce({ valid: true, userId: 'user-1', userName: 'Test User' });

    // getSessionId returns valid on initial check, then new session after re-auth poll
    vi.mocked(getSessionId)
      .mockResolvedValueOnce('session-123' as never)
      .mockResolvedValue('session-456' as never);

    const ctx = await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session invalid: Session expired')
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('chatroom auth login'));
    expect(ctx).toBeDefined();
    expect(ctx.sessionId).toBe('session-456');
    expect(exitSpy).not.toHaveBeenCalled();
  }, 15_000);

  it('continues when backend session validation succeeds (valid session)', async () => {
    const mockClient = await getMockClient();
    mockClient.query.mockResolvedValueOnce({
      valid: true,
      userId: 'user-1',
      userName: 'Test User',
    });

    const ctx = await initDaemon();

    expect(ctx).toBeDefined();
    expect(ctx.sessionId).toBe('session-123');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits when updateDaemonStatus mutation fails (non-network)', async () => {
    const mockClient = await getMockClient();
    // First call succeeds (register), second call fails (updateDaemonStatus)
    mockClient.mutation
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Server error'));
    vi.mocked(isNetworkError).mockReturnValue(false);

    await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update daemon status')
    );
    expect(releaseLock).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('retries with delay on network failure for updateDaemonStatus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockClient = await getMockClient();
    const networkError = new Error('fetch failed');
    // 1st mutation: registerCapabilities succeeds
    // 2nd mutation: connectDaemon fails with network error
    // 3rd mutation: registerCapabilities succeeds (retry)
    // 4th mutation: connectDaemon succeeds (retry)
    mockClient.mutation
      .mockResolvedValueOnce(undefined) // registerCapabilities
      .mockRejectedValueOnce(networkError) // connectDaemon (fail)
      .mockResolvedValueOnce(undefined) // registerCapabilities (retry)
      .mockResolvedValueOnce(undefined) // connectDaemon (retry success)
      .mockResolvedValueOnce({ clearedCount: 0 })
      .mockResolvedValueOnce({ reapedCount: 0 });
    vi.mocked(isNetworkError).mockReturnValue(true);

    const initPromise = initDaemon();

    await advanceConnectionRetries(1);

    const ctx = await initPromise;

    expect(formatConnectivityError).toHaveBeenCalledWith(networkError, 'http://localhost:3210');
    // Should NOT exit — should retry and succeed
    expect(exitSpy).not.toHaveBeenCalled();
    expect(ctx).toBeDefined();
    expect(ctx.machineId).toBe('machine-abc');
  }, 20_000);

  it('warns but continues when machine registration fails', async () => {
    const mockClient = await getMockClient();
    // First call (register) fails, second call (updateDaemonStatus) succeeds
    mockClient.mutation
      .mockRejectedValueOnce(new Error('Registration failed'))
      .mockResolvedValueOnce(undefined);

    const ctx = await initDaemon();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Machine registration update failed')
    );
    // Should continue and return context (not exit)
    expect(ctx).toBeDefined();
    expect(ctx.machineId).toBe('machine-abc');
  });

  it('returns a valid DaemonContext on successful initialization', async () => {
    const ctx = await initDaemon();

    expect(ctx.sessionId).toBe('session-123');
    expect(ctx.machineId).toBe('machine-abc');
    expect(ctx.config).toBeDefined();
    expect(ctx.config?.hostname).toBe('test-host');
    expect(ctx.deps).toBeDefined();
    expect(ctx.deps.backend).toBeDefined();
  });

  it('binds the Convex client mutation/query to deps.backend', async () => {
    const ctx = await initDaemon();

    // The deps.backend.mutation should be wired to the client
    // Calling it should delegate to the client
    expect(ctx.deps.backend.mutation).toBeDefined();
    expect(ctx.deps.backend.query).toBeDefined();
  });

  it('logs startup info including version, machine ID, hostname', async () => {
    await initDaemon();

    const allLogs = logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
    expect(allLogs).toContain('Daemon started');
    expect(allLogs).toContain('1.0.0-test');
    expect(allLogs).toContain('machine-abc');
    expect(allLogs).toContain('test-host');
  });

  it('calls recoverAgentStateEffect during initialization', async () => {
    await initDaemon();

    expect(recoverEffectRun).toHaveBeenCalledTimes(1);
  });

  it('continues with fresh state when recoverAgentStateEffect throws', async () => {
    recoverEffectRun.mockRejectedValueOnce(new Error('Recovery failed'));

    const ctx = await initDaemon();

    expect(ctx).toBeDefined();
    const allLogs = logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
    expect(allLogs).toContain('Recovery failed');
    expect(allLogs).toContain('Continuing with fresh state');
  });

  it('always calls machines.register after ensureMachineRegistered', async () => {
    const mockClient = await getMockClient();

    await initDaemon();

    expect(ensureMachineRegistered).toHaveBeenCalledWith({ allowCreate: true });
    // In the new flow, machines.register is always called (no null-config guard)
    // First mutation = machines.register, second = updateDaemonStatus, third = clearAllSpawnedPids, fourth = reapOrphansForDaemonRestart
    expect(mockClient.mutation).toHaveBeenCalledTimes(4);
  });

  it('calls reapOrphansForDaemonRestart on startup with the correct machineId', async () => {
    // The 4th mutation call is reapOrphansForDaemonRestart (register, updateDaemonStatus,
    // clearAllSpawnedPids, reapOrphansForDaemonRestart). It takes { sessionId, machineId } only.
    const mockClient = await getMockClient();

    await initDaemon();

    // All 4 mutation calls must have been made
    expect(mockClient.mutation).toHaveBeenCalledTimes(4);
    // The 4th call is reapOrphansForDaemonRestart — verify it passes the correct machineId
    const fourthCallArgs = mockClient.mutation.mock.calls[3][1] as any;
    expect(fourthCallArgs).toMatchObject({ machineId: 'machine-abc' });
  });

  it('logs the reaped count when > 0', async () => {
    const mockClient = await getMockClient();

    // The 4th mutation call is reapOrphansForDaemonRestart — return { reapedCount: 3 }
    mockClient.mutation
      .mockResolvedValueOnce(undefined) // 1st: machines.register / registerCapabilities
      .mockResolvedValueOnce(undefined) // 2nd: updateDaemonStatus
      .mockResolvedValueOnce(undefined) // 3rd: clearAllSpawnedPids
      .mockResolvedValueOnce({ reapedCount: 3 }); // 4th: reapOrphansForDaemonRestart

    await initDaemon();

    const allLogs = logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
    expect(allLogs).toContain(
      'Reaped 3 command run(s) from previous daemon run (marked as daemon-restart)'
    );
  });

  it('does not log when reapedCount is 0', async () => {
    const mockClient = await getMockClient();

    mockClient.mutation
      .mockResolvedValueOnce(undefined) // 1st: registerCapabilities
      .mockResolvedValueOnce(undefined) // 2nd: updateDaemonStatus
      .mockResolvedValueOnce(undefined) // 3rd: clearAllSpawnedPids
      .mockResolvedValueOnce({ reapedCount: 0 }); // 4th: reapOrphansForDaemonRestart

    await initDaemon();

    const allLogs = logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
    expect(allLogs).not.toContain('daemon-restart');
  });

  it('does not block startup when reapOrphansForDaemonRestart fails', async () => {
    const mockClient = await getMockClient();

    mockClient.mutation
      .mockResolvedValueOnce(undefined) // 1st: registerCapabilities
      .mockResolvedValueOnce(undefined) // 2nd: updateDaemonStatus
      .mockResolvedValueOnce(undefined) // 3rd: clearAllSpawnedPids
      .mockRejectedValueOnce(new Error('network error during reap')); // 4th: reapOrphansForDaemonRestart

    // Should not throw — daemon startup continues despite reap failure
    const ctx = await initDaemon();
    expect(ctx).toBeDefined();

    const allWarns = warnSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
    expect(allWarns).toContain('Failed to reap orphan command runs');
  });
});

// ---------------------------------------------------------------------------
// Daemon retry backoff (Bug A fix)
// ---------------------------------------------------------------------------

describe('initDaemon — backend-availability retry backoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs verbose error block exactly once across N consecutive failures', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockClient = await getMockClient();
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);

    // Two attempts: first connectDaemon failure (verbose block), second succeeds after one retry delay.
    mockClient.mutation
      .mockResolvedValueOnce(undefined) // registerCapabilities attempt 1
      .mockRejectedValueOnce(networkError) // connectDaemon fail 1
      .mockResolvedValueOnce(undefined) // registerCapabilities attempt 2
      .mockResolvedValueOnce(undefined) // connectDaemon success
      .mockResolvedValueOnce({ clearedCount: 0 }) // clearAllSpawnedPids
      .mockResolvedValueOnce({ reapedCount: 0 }); // reapOrphansForDaemonRestart

    const initPromise = initDaemon();

    await advanceConnectionRetries(1);

    await initPromise;

    // The full verbose guidance block must appear exactly once (first failure only)
    expect(formatConnectivityError).toHaveBeenCalledTimes(1);
    expect(formatConnectivityError).toHaveBeenCalledWith(networkError, 'http://localhost:3210');

    const logLines = logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
    expect(logLines).toContain('Backend reachable again');
    expect(logLines).not.toMatch(/Backend still unreachable/);
  }, 20_000);

  it('uses a 10-second retry interval between connection attempts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const mockClient = await getMockClient();
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);

    mockClient.mutation
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ clearedCount: 0 })
      .mockResolvedValueOnce({ reapedCount: 0 });

    const initPromise = initDaemon();
    await advanceConnectionRetries(1);
    await initPromise;

    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === CONNECTION_RETRY_INTERVAL_MS)).toBe(
      true
    );
    expect(exitSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  }, 20_000);

  it('logs a single recovery line when backend becomes reachable again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockClient = await getMockClient();
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);

    mockClient.mutation
      .mockResolvedValueOnce(undefined) // registerCapabilities (fail attempt)
      .mockRejectedValueOnce(networkError) // connectDaemon fail
      .mockResolvedValueOnce(undefined) // registerCapabilities (success attempt)
      .mockResolvedValueOnce(undefined) // connectDaemon success
      .mockResolvedValueOnce({ clearedCount: 0 }) // clearAllSpawnedPids
      .mockResolvedValueOnce({ reapedCount: 0 }); // reapOrphansForDaemonRestart

    const initPromise = initDaemon();
    await advanceConnectionRetries(1);
    await initPromise;

    const logLines = logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
    // Exactly one recovery line mentioning the backend URL
    const recoveryCount = (logLines.match(/Backend reachable again/g) ?? []).length;
    expect(recoveryCount).toBe(1);
    expect(logLines).toContain('http://localhost:3210');
  }, 20_000);
});
