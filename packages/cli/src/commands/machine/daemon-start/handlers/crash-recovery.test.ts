/**
 * Crash Recovery Handler Tests
 *
 * Tests for handleAgentCrashRecovery using dependency injection.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../../../../api.js';
import type { DaemonDeps } from '../deps.js';
import type { DaemonContext, StartAgentCommand } from '../types.js';

// ---------------------------------------------------------------------------
// Mock module-level imports used by handler files
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/config/reliability.js', () => ({
  CRASH_RESTART_DELAY_MS: 0,
  DAEMON_HEARTBEAT_INTERVAL_MS: 30_000,
  MAX_CRASH_RESTART_ATTEMPTS: 3,
}));

vi.mock('../../pid.js', () => ({
  acquireLock: vi.fn(() => true),
  releaseLock: vi.fn(),
}));

vi.mock('../../../../api.js', () => ({
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

vi.mock('../../../../infrastructure/agent-drivers/index.js', () => ({
  getDriverRegistry: vi.fn(() => ({
    get: vi.fn(),
    all: vi.fn(() => []),
  })),
}));

vi.mock('../../../../infrastructure/auth/storage.js', () => ({
  getSessionId: vi.fn(() => 'test-session'),
  getOtherSessionUrls: vi.fn(() => []),
}));

vi.mock('../../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn(() => 'http://test:3210'),
  getConvexClient: vi.fn(),
  getConvexWsClient: vi.fn(),
}));

vi.mock('../../../../infrastructure/machine/index.js', () => ({
  clearAgentPid: vi.fn(),
  getMachineId: vi.fn(() => 'test-machine'),
  listAgentEntries: vi.fn(() => []),
  loadMachineConfig: vi.fn(() => null),
  getAgentContext: vi.fn(() => null),
  persistAgentPid: vi.fn(),
  updateAgentContext: vi.fn(),
}));

vi.mock('../../../../infrastructure/machine/intentional-stops.js', () => ({
  markIntentionalStop: vi.fn(),
  consumeIntentionalStop: vi.fn(() => false),
  clearIntentionalStop: vi.fn(),
}));

vi.mock('../../../../utils/error-formatting.js', () => ({
  isNetworkError: vi.fn(() => false),
  formatConnectivityError: vi.fn(),
}));

vi.mock('../../../../version.js', () => ({
  getVersion: vi.fn(() => '1.0.0'),
}));

// ---------------------------------------------------------------------------
// Import the function under test (after mocks are set up)
// ---------------------------------------------------------------------------

const { handleAgentCrashRecovery } = await import('./crash-recovery.js');

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
    config: null as unknown as DaemonContext['config'],
    deps,
  };
}

const CHATROOM_ID = 'test-chatroom-123' as Id<'chatroom_rooms'>;
const COMMAND_ID = 'cmd-123' as Id<'chatroom_machineCommands'>;

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
// Tests
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

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'participants.leave',
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
      })
    );

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

    expect(deps.clock.delay).toHaveBeenCalled();
  });

  it('sets dead_failed_revive after all restart attempts fail', async () => {
    await handleAgentCrashRecovery(ctx, createStartCommand());

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
    vi.mocked(deps.machine.getAgentContext).mockReturnValue({
      agentType: 'opencode',
      workingDir: '/tmp/test',
      lastStartedAt: new Date().toISOString(),
    });

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

    vi.mocked(deps.backend.query).mockResolvedValue({
      prompt: 'test prompt',
      rolePrompt: 'test role prompt',
      initialMessage: 'test initial message',
    });

    await handleAgentCrashRecovery(ctx, createStartCommand());

    const deadCalls = vi
      .mocked(deps.backend.mutation)
      .mock.calls.filter(
        (call) =>
          call[0] === 'participants.updateAgentStatus' && call[1]?.status === 'dead_failed_revive'
      );
    expect(deadCalls).toHaveLength(0);
  });
});
