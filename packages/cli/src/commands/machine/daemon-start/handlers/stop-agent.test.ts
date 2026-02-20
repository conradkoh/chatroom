/**
 * Stop Agent Handler Tests
 *
 * Tests for handleStopAgent using dependency injection.
 * The handler now delegates to onAgentShutdown for kill + cleanup.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../../../../api.js';
import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';
import type { DaemonDeps } from '../deps.js';
import { DaemonEventBus } from '../event-bus.js';
import type { DaemonContext, StopAgentCommand } from '../types.js';

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
    machineAgentLifecycle: {
      transition: 'machineAgentLifecycle.transition',
      heartbeat: 'machineAgentLifecycle.heartbeat',
    },
  },
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
  persistAgentPid: vi.fn(),
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

const { handleStopAgent } = await import('./stop-agent.js');

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
    events: new DaemonEventBus(),
    remoteAgentService: new OpenCodeAgentService({
      execSync: vi.fn(),
      spawn: vi.fn() as any,
      kill: vi.fn(),
    }),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleStopAgent', () => {
  let deps: DaemonDeps;
  let ctx: DaemonContext;

  beforeEach(() => {
    deps = createMockDeps();
    ctx = createCtx(deps);
  });

  it('delegates to onAgentShutdown which marks intentional stop', async () => {
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

    // processes.kill with signal 0 throws ESRCH to indicate process died after SIGTERM
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
        if (signal === 0) throw new Error('ESRCH');
      }
    );

    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(false);
    // onAgentShutdown calls stops.mark internally
    expect(deps.stops.mark).toHaveBeenCalledWith(CHATROOM_ID, 'builder');
  });

  it('clears PID from backend and local state via onAgentShutdown', async () => {
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

    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
        if (signal === 0) throw new Error('ESRCH');
      }
    );

    await handleStopAgent(ctx, createStopCommand());

    // onAgentShutdown clears PID via backend mutation
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'machines.updateSpawnedAgent',
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        pid: undefined,
      })
    );

    // onAgentShutdown clears local PID state
    expect(deps.machine.clearAgentPid).toHaveBeenCalledWith('test-machine', CHATROOM_ID, 'builder');
  });

  it('removes participant record via onAgentShutdown', async () => {
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

    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
        if (signal === 0) throw new Error('ESRCH');
      }
    );

    await handleStopAgent(ctx, createStopCommand());

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
    expect(deps.stops.mark).not.toHaveBeenCalled();
  });

  it('sends SIGTERM to negative PID (process group) via onAgentShutdown', async () => {
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

    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
        if (signal === 0) throw new Error('ESRCH');
      }
    );

    await handleStopAgent(ctx, createStopCommand());

    // onAgentShutdown sends SIGTERM to -pid (process group)
    expect(deps.processes.kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
  });

  it('handles stale PID (process not alive)', async () => {
    vi.spyOn(ctx.remoteAgentService, 'isAlive').mockReturnValue(false);

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
    expect(deps.stops.mark).not.toHaveBeenCalled();
    expect(deps.machine.clearAgentPid).toHaveBeenCalled();
  });
});
