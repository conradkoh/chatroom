/**
 * Daemon Command Handler Tests
 *
 * Tests for handleStopAgent and handleAgentCrashRecovery using dependency
 * injection to avoid mocking module imports.
 *
 * Test categories:
 * 1. handleStopAgent — intentional stop flow
 *    - Marks intentional stop before killing
 *    - Clears PID and removes participant on success
 *    - Cleans up intentional stop marker on failure
 *    - Handles stale PID (process not found)
 *
 * 2. handleAgentCrashRecovery — crash recovery flow
 *    - Clears PID, leaves participant, sets "restarting" status
 *    - Retries start up to MAX_CRASH_RESTART_ATTEMPTS
 *    - Sets "dead_failed_revive" after all attempts fail
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DaemonDeps } from './daemon-deps.js';
import type { DaemonContext, StartAgentCommand, StopAgentCommand } from './daemon-start.js';
import type { Id } from '../../api.js';

// ---------------------------------------------------------------------------
// Mock module-level imports that daemon-start.ts uses at the top level
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/config/reliability.js', () => ({
  CRASH_RESTART_DELAY_MS: 0,
  DAEMON_HEARTBEAT_INTERVAL_MS: 30_000,
  MAX_CRASH_RESTART_ATTEMPTS: 3,
}));

vi.mock('./pid.js', () => ({
  acquireLock: vi.fn(() => true),
  releaseLock: vi.fn(),
}));

vi.mock('../../api.js', () => ({
  api: {
    machines: {
      updateSpawnedAgent: 'machines.updateSpawnedAgent',
      getAgentConfigs: 'machines.getAgentConfigs',
      ackCommand: 'machines.ackCommand',
      register: 'machines.register',
      daemonHeartbeat: 'machines.daemonHeartbeat',
      updateDaemonStatus: 'machines.updateDaemonStatus',
    },
    participants: {
      leave: 'participants.leave',
      updateAgentStatus: 'participants.updateAgentStatus',
    },
    messages: {
      getInitPrompt: 'messages.getInitPrompt',
    },
  },
}));

vi.mock('../../infrastructure/agent-drivers/index.js', () => ({
  getDriverRegistry: vi.fn(() => ({
    get: vi.fn(),
    all: vi.fn(() => []),
    capabilities: vi.fn(),
  })),
}));

vi.mock('../../infrastructure/auth/storage.js', () => ({
  getSessionId: vi.fn(() => 'test-session'),
  getOtherSessionUrls: vi.fn(() => []),
}));

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn(() => 'http://test:3210'),
  getConvexClient: vi.fn(),
  getConvexWsClient: vi.fn(),
}));

vi.mock('../../infrastructure/machine/index.js', () => ({
  clearAgentPid: vi.fn(),
  getMachineId: vi.fn(() => 'test-machine'),
  listAgentEntries: vi.fn(() => []),
  loadMachineConfig: vi.fn(() => null),
  getAgentContext: vi.fn(() => null),
  persistAgentPid: vi.fn(),
  updateAgentContext: vi.fn(),
}));

vi.mock('../../infrastructure/machine/intentional-stops.js', () => ({
  markIntentionalStop: vi.fn(),
  consumeIntentionalStop: vi.fn(() => false),
  clearIntentionalStop: vi.fn(),
}));

vi.mock('../../utils/error-formatting.js', () => ({
  isNetworkError: vi.fn(() => false),
  formatConnectivityError: vi.fn(),
}));

vi.mock('../../version.js', () => ({
  getVersion: vi.fn(() => '1.0.0'),
}));

// ---------------------------------------------------------------------------
// Now import the functions under test (after mocks are set up)
// ---------------------------------------------------------------------------

const { handleStopAgent, handleAgentCrashRecovery } = await import('./daemon-start.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<DaemonDeps>): DaemonDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ configs: [] }),
    },
    processes: {
      kill: vi.fn(),
      verifyPidOwnership: vi.fn(() => true),
    },
    drivers: {
      get: vi.fn(() => ({
        harness: 'opencode' as const,
        capabilities: {
          sessionPersistence: false,
          abort: false,
          modelSelection: false,
          compaction: false,
          eventStreaming: false,
          messageInjection: false,
          dynamicModelDiscovery: false,
        },
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        isAlive: vi.fn().mockResolvedValue(true),
        recover: vi.fn().mockResolvedValue([]),
        listModels: vi.fn().mockResolvedValue([]),
      })),
      all: vi.fn(() => []),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
    stops: {
      mark: vi.fn(),
      consume: vi.fn(() => false),
      clear: vi.fn(),
    },
    machine: {
      clearAgentPid: vi.fn(),
      persistAgentPid: vi.fn(),
      listAgentEntries: vi.fn(() => []),
      getAgentContext: vi.fn(() => null),
      updateAgentContext: vi.fn(),
    },
    clock: {
      now: () => Date.now(),
      delay: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function createCtx(deps: DaemonDeps): DaemonContext {
  return {
    client: {} as DaemonContext['client'],
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null as DaemonContext['config'],
    deps,
  };
}

const CHATROOM_ID = 'test-chatroom-123' as Id<'chatroom_rooms'>;
const COMMAND_ID = 'cmd-123' as Id<'chatroom_machineCommands'>;

function createStopCommand(overrides?: Partial<StopAgentCommand['payload']>): StopAgentCommand {
  return {
    _id: COMMAND_ID,
    type: 'stop-agent',
    payload: {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      ...overrides,
    },
    createdAt: Date.now(),
  };
}

function createStartCommand(overrides?: Partial<StartAgentCommand['payload']>): StartAgentCommand {
  return {
    _id: COMMAND_ID,
    type: 'start-agent',
    payload: {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      agentHarness: 'opencode',
      ...overrides,
    },
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// handleStopAgent
// ---------------------------------------------------------------------------

describe('handleStopAgent', () => {
  let deps: DaemonDeps;
  let ctx: DaemonContext;

  beforeEach(() => {
    deps = createMockDeps();
    ctx = createCtx(deps);
  });

  it('marks intentional stop before killing the process', async () => {
    // Backend returns a config with a running PID
    vi.mocked(deps.backend.query).mockResolvedValue({
      configs: [
        {
          machineId: 'test-machine',
          role: 'builder',
          spawnedAgentPid: 1234,
          agentType: 'opencode',
        },
      ],
    });

    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(false);
    expect(deps.stops.mark).toHaveBeenCalledWith(CHATROOM_ID, 'builder');
  });

  it('clears PID from backend and local state after successful stop', async () => {
    vi.mocked(deps.backend.query).mockResolvedValue({
      configs: [
        {
          machineId: 'test-machine',
          role: 'builder',
          spawnedAgentPid: 1234,
          agentType: 'opencode',
        },
      ],
    });

    await handleStopAgent(ctx, createStopCommand());

    // Should have called mutation to clear PID (updateSpawnedAgent with pid: undefined)
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'machines.updateSpawnedAgent',
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        pid: undefined,
      })
    );

    // Should have called local clearAgentPid
    expect(deps.machine.clearAgentPid).toHaveBeenCalledWith('test-machine', CHATROOM_ID, 'builder');
  });

  it('removes participant record after successful stop', async () => {
    vi.mocked(deps.backend.query).mockResolvedValue({
      configs: [
        {
          machineId: 'test-machine',
          role: 'builder',
          spawnedAgentPid: 1234,
          agentType: 'opencode',
        },
      ],
    });

    await handleStopAgent(ctx, createStopCommand());

    // Should have called participants.leave
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'participants.leave',
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
      })
    );
  });

  it('returns failed when no PID is recorded', async () => {
    vi.mocked(deps.backend.query).mockResolvedValue({
      configs: [
        {
          machineId: 'test-machine',
          role: 'builder',
          spawnedAgentPid: undefined,
        },
      ],
    });

    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(true);
    expect(result.result).toContain('No running agent found');
    // Should NOT have marked intentional stop
    expect(deps.stops.mark).not.toHaveBeenCalled();
  });

  it('clears intentional stop marker when kill throws ESRCH', async () => {
    // Create a dedicated driver mock that rejects on stop
    const driverMock = {
      harness: 'opencode' as const,
      capabilities: {} as ReturnType<typeof vi.fn>,
      start: vi.fn(),
      stop: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Process not found'), { code: 'ESRCH' })),
      isAlive: vi.fn().mockResolvedValue(true),
      recover: vi.fn(),
      listModels: vi.fn(),
    };
    vi.mocked(deps.drivers.get).mockReturnValue(driverMock as never);

    vi.mocked(deps.backend.query).mockResolvedValue({
      configs: [
        {
          machineId: 'test-machine',
          role: 'builder',
          spawnedAgentPid: 1234,
          agentType: 'opencode',
        },
      ],
    });

    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(true);
    // Should have cleaned up the intentional stop marker
    expect(deps.stops.clear).toHaveBeenCalledWith(CHATROOM_ID, 'builder');
  });

  it('handles stale PID (process not alive)', async () => {
    // Create a dedicated driver mock where isAlive returns false
    const driverMock = {
      harness: 'opencode' as const,
      capabilities: {} as ReturnType<typeof vi.fn>,
      start: vi.fn(),
      stop: vi.fn(),
      isAlive: vi.fn().mockResolvedValue(false),
      recover: vi.fn(),
      listModels: vi.fn(),
    };
    vi.mocked(deps.drivers.get).mockReturnValue(driverMock as never);

    vi.mocked(deps.backend.query).mockResolvedValue({
      configs: [
        {
          machineId: 'test-machine',
          role: 'builder',
          spawnedAgentPid: 1234,
          agentType: 'opencode',
        },
      ],
    });

    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(true);
    expect(result.result).toContain('stale');
    // Should NOT have marked intentional stop (no SIGTERM sent)
    expect(deps.stops.mark).not.toHaveBeenCalled();
    // Should still clear PID
    expect(deps.machine.clearAgentPid).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleAgentCrashRecovery
// ---------------------------------------------------------------------------

describe('handleAgentCrashRecovery', () => {
  let deps: DaemonDeps;
  let ctx: DaemonContext;

  beforeEach(() => {
    deps = createMockDeps();
    ctx = createCtx(deps);
  });

  it('clears PID from backend and local state', async () => {
    await handleAgentCrashRecovery(ctx, createStartCommand());

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'machines.updateSpawnedAgent',
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        pid: undefined,
      })
    );
    expect(deps.machine.clearAgentPid).toHaveBeenCalledWith('test-machine', CHATROOM_ID, 'builder');
  });

  it('marks participant as offline (leave) then sets restarting status', async () => {
    await handleAgentCrashRecovery(ctx, createStartCommand());

    // Should call participants.leave
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'participants.leave',
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
      })
    );

    // Should set status to "restarting"
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'participants.updateAgentStatus',
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        status: 'restarting',
      })
    );
  });

  it('uses clock.delay between restart attempts', async () => {
    await handleAgentCrashRecovery(ctx, createStartCommand());

    // CRASH_RESTART_DELAY_MS is mocked to 0, but delay should still be called
    expect(deps.clock.delay).toHaveBeenCalled();
  });

  it('sets dead_failed_revive after all restart attempts fail', async () => {
    // All restart attempts will fail because getAgentContext returns null
    // (handleStartAgent will fail with "No agent context found")

    await handleAgentCrashRecovery(ctx, createStartCommand());

    // Should set status to "dead_failed_revive" after all attempts
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'participants.updateAgentStatus',
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        status: 'dead_failed_revive',
      })
    );
  });

  it('does not set dead_failed_revive if a restart attempt succeeds', async () => {
    // Make restart succeed by providing agent context and a successful driver start
    vi.mocked(deps.machine.getAgentContext).mockReturnValue({
      agentType: 'opencode',
      workingDir: '/tmp/test',
      lastStartedAt: new Date().toISOString(),
    });

    // Create a persistent driver mock with successful start
    const driverMock = {
      harness: 'opencode' as const,
      capabilities: {} as ReturnType<typeof vi.fn>,
      start: vi.fn().mockResolvedValue({
        success: true,
        message: 'Agent started',
        handle: {
          harness: 'opencode',
          type: 'process',
          pid: 5678,
          workingDir: '/tmp/test',
        },
      }),
      stop: vi.fn(),
      isAlive: vi.fn().mockResolvedValue(true),
      recover: vi.fn(),
      listModels: vi.fn(),
    };
    vi.mocked(deps.drivers.get).mockReturnValue(driverMock as never);

    // Mock init prompt
    vi.mocked(deps.backend.query).mockResolvedValue({
      prompt: 'test prompt',
      rolePrompt: 'test role prompt',
      initialMessage: 'test initial message',
    });

    await handleAgentCrashRecovery(ctx, createStartCommand());

    // Should NOT have called with dead_failed_revive
    const deadCalls = vi
      .mocked(deps.backend.mutation)
      .mock.calls.filter(
        (call) =>
          call[0] === 'participants.updateAgentStatus' && call[1]?.status === 'dead_failed_revive'
      );
    expect(deadCalls).toHaveLength(0);
  });
});
