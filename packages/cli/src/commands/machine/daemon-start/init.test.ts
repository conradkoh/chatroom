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
import { getDriverRegistry } from '../../../infrastructure/agent-drivers/index.js';
import { getSessionId, getOtherSessionUrls } from '../../../infrastructure/auth/storage.js';
import { getConvexUrl, getConvexClient } from '../../../infrastructure/convex/client.js';
import { getMachineId, loadMachineConfig } from '../../../infrastructure/machine/index.js';
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
    query: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../infrastructure/machine/index.js', () => ({
  getMachineId: vi.fn().mockReturnValue('machine-abc'),
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
}));

vi.mock('../../../infrastructure/machine/intentional-stops.js', () => ({
  markIntentionalStop: vi.fn(),
  consumeIntentionalStop: vi.fn().mockReturnValue(false),
  clearIntentionalStop: vi.fn(),
}));

vi.mock('../../../infrastructure/agent-drivers/index.js', () => ({
  getDriverRegistry: vi.fn().mockReturnValue({
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  }),
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

/**
 * Default mock registry returned by getDriverRegistry.
 * Must be reset before each test because some tests override it.
 */
function createDefaultMockRegistry() {
  return {
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
}

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
    query: vi.fn().mockResolvedValue(undefined),
  } as never);
  vi.mocked(getMachineId).mockReturnValue('machine-abc');
  vi.mocked(loadMachineConfig).mockReturnValue({
    machineId: 'machine-abc',
    hostname: 'test-host',
    os: 'darwin',
    registeredAt: '2026-01-01T00:00:00Z',
    lastSyncedAt: '2026-01-01T00:00:00Z',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
  } as never);
  vi.mocked(getDriverRegistry).mockReturnValue(createDefaultMockRegistry() as never);
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
  it('returns empty array when no drivers support dynamic model discovery', async () => {
    vi.mocked(getDriverRegistry).mockReturnValue({
      get: vi.fn(),
      all: vi
        .fn()
        .mockReturnValue([{ capabilities: { dynamicModelDiscovery: false }, listModels: vi.fn() }]),
    } as never);

    const models = await discoverModels();
    expect(models).toEqual([]);
  });

  it('collects models from drivers with dynamic model discovery', async () => {
    vi.mocked(getDriverRegistry).mockReturnValue({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([
        {
          capabilities: { dynamicModelDiscovery: true },
          listModels: vi.fn().mockResolvedValue(['gpt-4', 'gpt-3.5']),
        },
        {
          capabilities: { dynamicModelDiscovery: true },
          listModels: vi.fn().mockResolvedValue(['claude-3']),
        },
      ]),
    } as never);

    const models = await discoverModels();
    expect(models).toEqual(['gpt-4', 'gpt-3.5', 'claude-3']);
  });

  it('returns empty array on registry error (non-critical)', async () => {
    vi.mocked(getDriverRegistry).mockImplementationOnce(() => {
      throw new Error('Registry broken');
    });

    const models = await discoverModels();
    expect(models).toEqual([]);
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

  it('exits when session ID is missing', async () => {
    vi.mocked(getSessionId).mockReturnValue(null);

    await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'));
    expect(releaseLock).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('shows other session URLs when not authenticated', async () => {
    vi.mocked(getSessionId).mockReturnValue(null);
    vi.mocked(getOtherSessionUrls).mockReturnValue(['http://other:3210']);

    await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('other environments'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('http://other:3210'));
  });

  it('exits when machine ID is missing', async () => {
    vi.mocked(getMachineId).mockReturnValue(null as never);

    await initDaemon();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Machine not registered'));
    expect(releaseLock).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
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

  it('calls formatConnectivityError on network failure for updateDaemonStatus', async () => {
    const mockClient = await getMockClient();
    const networkError = new Error('fetch failed');
    mockClient.mutation.mockResolvedValueOnce(undefined).mockRejectedValueOnce(networkError);
    vi.mocked(isNetworkError).mockReturnValue(true);

    await initDaemon();

    expect(formatConnectivityError).toHaveBeenCalledWith(networkError, 'http://localhost:3210');
    expect(exitSpy).toHaveBeenCalledWith(1);
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

  it('skips machine registration when config is null', async () => {
    vi.mocked(loadMachineConfig).mockReturnValue(null as never);
    const mockClient = await getMockClient();

    await initDaemon();

    // updateDaemonStatus is called but register should not be
    // With null config, only 1 mutation call (updateDaemonStatus), not 2
    expect(mockClient.mutation).toHaveBeenCalledTimes(1);
  });
});
