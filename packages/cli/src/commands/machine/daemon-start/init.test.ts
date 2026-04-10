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

import { recoverAgentState } from './handlers/state-recovery.js';
import { initDaemon, discoverModels } from './init.js';
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
  getSessionId: vi.fn().mockReturnValue('session-123'),
  getOtherSessionUrls: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
  getConvexClient: vi.fn().mockResolvedValue({
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ valid: true, userId: 'user-1', userName: 'Test User' }),
  }),
}));

vi.mock('../../../infrastructure/machine/index.js', () => ({
  ensureMachineRegistered: vi.fn().mockReturnValue({
    machineId: 'machine-abc',
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
  }),
  loadMachineConfig: vi.fn().mockReturnValue({
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
  listAgentEntries: vi.fn().mockReturnValue([]),
  persistEventCursor: vi.fn(),
  loadEventCursor: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../utils/error-formatting.js', () => ({
  isNetworkError: vi.fn().mockReturnValue(false),
  formatConnectivityError: vi.fn(),
}));

vi.mock('../../../version.js', () => ({
  getVersion: vi.fn().mockReturnValue('1.0.0-test'),
}));

vi.mock('./handlers/state-recovery.js', () => ({
  recoverAgentState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../infrastructure/services/remote-agents/opencode/index.js', () => {
  return {
    OpenCodeAgentService: class MockOpenCodeAgentService {
      isInstalled = vi.fn().mockReturnValue(true);
      getVersion = vi.fn().mockReturnValue({ version: '0.1.0', major: 0 });
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
  vi.mocked(getSessionId).mockReturnValue('session-123' as never);
  vi.mocked(getOtherSessionUrls).mockReturnValue([]);
  vi.mocked(getConvexUrl).mockReturnValue('http://localhost:3210');
  vi.mocked(getConvexClient).mockResolvedValue({
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ valid: true, userId: 'user-1', userName: 'Test User' }),
  } as never);
  vi.mocked(ensureMachineRegistered).mockReturnValue({
    machineId: 'machine-abc',
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
  } as never);
  vi.mocked(loadMachineConfig).mockReturnValue({
    machineId: 'machine-abc',
    hostname: 'test-host',
    os: 'darwin',
    registeredAt: '2026-01-01T00:00:00Z',
    lastSyncedAt: '2026-01-01T00:00:00Z',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
  } as never);
  vi.mocked(recoverAgentState).mockResolvedValue(undefined);
  vi.mocked(isNetworkError).mockReturnValue(false);

  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
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

// ---------------------------------------------------------------------------
// discoverModels
// ---------------------------------------------------------------------------

describe('discoverModels', () => {
  it('returns models from the remote agent service', async () => {
    const mockService = {
      isInstalled: vi.fn().mockReturnValue(true),
      listModels: vi.fn().mockResolvedValue(['gpt-4', 'claude-3']),
    } as any;

    const agentServices = new Map([['opencode', mockService]]);
    const models = await discoverModels(agentServices);
    expect(models).toEqual({ opencode: ['gpt-4', 'claude-3'] });
    expect(mockService.listModels).toHaveBeenCalledOnce();
  });

  it('returns empty record entry when service throws (non-critical)', async () => {
    const mockService = {
      isInstalled: vi.fn().mockReturnValue(true),
      listModels: vi.fn().mockRejectedValue(new Error('Service broken')),
    } as any;

    const agentServices = new Map([['opencode', mockService]]);
    const models = await discoverModels(agentServices);
    expect(models).toEqual({ opencode: [] });
  });

  it('returns empty record when service is not installed', async () => {
    const mockService = {
      isInstalled: vi.fn().mockReturnValue(false),
      listModels: vi.fn().mockResolvedValue([]),
    } as any;

    const agentServices = new Map([['opencode', mockService]]);
    const models = await discoverModels(agentServices);
    expect(models).toEqual({});
  });

  it('discovers models from multiple harnesses independently', async () => {
    const opencodeService = {
      isInstalled: vi.fn().mockReturnValue(true),
      listModels: vi.fn().mockResolvedValue(['opencode/model-a']),
    } as any;
    const piService = {
      isInstalled: vi.fn().mockReturnValue(true),
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
      isInstalled: vi.fn().mockReturnValue(true),
      listModels: vi.fn().mockResolvedValue(['opencode/model-a']),
    } as any;
    const piService = {
      isInstalled: vi.fn().mockReturnValue(false),
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
      isInstalled: vi.fn().mockReturnValue(true),
      listModels: vi.fn().mockRejectedValue(new Error('opencode broke')),
    } as any;
    const piService = {
      isInstalled: vi.fn().mockReturnValue(true),
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
});

// ---------------------------------------------------------------------------
// initDaemon
// ---------------------------------------------------------------------------

describe('initDaemon', () => {
  it('exits when lock cannot be acquired', async () => {
    vi.mocked(acquireLock).mockReturnValue(false);

    await initDaemon();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('waits for auth and resumes when session ID is initially missing', async () => {
    // First call returns null (unauthenticated), subsequent calls return valid session
    vi.mocked(getSessionId)
      .mockReturnValueOnce(null)
      .mockReturnValue('session-123' as never);

    const ctx = await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'));
    expect(ctx).toBeDefined();
    expect(ctx.sessionId).toBe('session-123');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('shows other session URLs when waiting for auth', async () => {
    vi.mocked(getSessionId)
      .mockReturnValueOnce(null)
      .mockReturnValue('session-123' as never);
    vi.mocked(getOtherSessionUrls).mockReturnValue(['http://other:3210']);

    const ctx = await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('other environments'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('http://other:3210'));
    expect(ctx).toBeDefined();
  });

  it('waits for re-auth when backend session validation fails', async () => {
    const mockClient = await getMockClient();
    // First validation fails, then succeeds after re-auth
    mockClient.query
      .mockResolvedValueOnce({ valid: false, reason: 'Session expired' })
      .mockResolvedValueOnce({ valid: true, userId: 'user-1', userName: 'Test User' });

    // getSessionId returns valid on initial check, then new session after re-auth poll
    vi.mocked(getSessionId)
      .mockReturnValueOnce('session-123' as never)
      .mockReturnValue('session-456' as never);

    const ctx = await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session invalid: Session expired')
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('chatroom auth login'));
    expect(ctx).toBeDefined();
    expect(ctx.sessionId).toBe('session-456');
    expect(exitSpy).not.toHaveBeenCalled();
  });

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
    vi.useFakeTimers();
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
      .mockResolvedValueOnce(undefined); // connectDaemon (retry success)
    vi.mocked(isNetworkError).mockReturnValue(true);

    const initPromise = initDaemon();

    // Advance past the 1s retry delay
    await vi.advanceTimersByTimeAsync(1500);

    const ctx = await initPromise;

    expect(formatConnectivityError).toHaveBeenCalledWith(networkError, 'http://localhost:3210');
    // Should NOT exit — should retry and succeed
    expect(exitSpy).not.toHaveBeenCalled();
    expect(ctx).toBeDefined();
    expect(ctx.machineId).toBe('machine-abc');

    vi.useRealTimers();
  });

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

  it('calls recoverAgentState during initialization', async () => {
    await initDaemon();

    expect(recoverAgentState).toHaveBeenCalledTimes(1);
    expect(recoverAgentState).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 'machine-abc' })
    );
  });

  it('continues with fresh state when recoverAgentState throws', async () => {
    vi.mocked(recoverAgentState).mockRejectedValueOnce(new Error('Recovery failed'));

    const ctx = await initDaemon();

    expect(ctx).toBeDefined();
    const allLogs = logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
    expect(allLogs).toContain('Recovery failed');
    expect(allLogs).toContain('Continuing with fresh state');
  });

  it('always calls machines.register after ensureMachineRegistered', async () => {
    const mockClient = await getMockClient();

    await initDaemon();

    // In the new flow, machines.register is always called (no null-config guard)
    // First mutation = machines.register, second = updateDaemonStatus, third = clearAllSpawnedPids
    expect(mockClient.mutation).toHaveBeenCalledTimes(3);
  });
});
