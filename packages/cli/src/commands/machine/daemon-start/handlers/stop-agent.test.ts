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
import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import type { DaemonContext, StopAgentCommand } from '../types.js';

// ---------------------------------------------------------------------------
// Mock module-level imports used by handler files
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/config/reliability.js', () => ({
  DAEMON_HEARTBEAT_INTERVAL_MS: 30_000,
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
      persistEventCursor: vi.fn(),
      loadEventCursor: vi.fn().mockReturnValue(null),
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
      persistEventCursor: vi.fn(),
      loadEventCursor: vi.fn().mockReturnValue(null),
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
    agentServices: new Map([
      [
        'opencode',
        new OpenCodeAgentService({
          execSync: vi.fn(),
          spawn: vi.fn() as any,
          kill: vi.fn(),
        }),
      ],
    ]),
  };
}

const CHATROOM_ID = 'test-chatroom-123' as Id<'chatroom_rooms'>;

function createStopCommand(overrides?: Partial<StopAgentCommand['payload']>): StopAgentCommand {
  return {
    type: 'stop-agent',
    reason: 'test',
    payload: {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      ...overrides,
    },
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

  it('clears local state via onAgentShutdown', async () => {
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

    // onAgentShutdown clears local PID state (backend cleanup via event listener)
    expect(deps.machine.clearAgentPid).toHaveBeenCalledWith('test-machine', CHATROOM_ID, 'builder');
    // No direct backend mutations from onAgentShutdown (backend cleanup via recordAgentExited)
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  it('does not call participants.leave directly (backend cleanup via event listener)', async () => {
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

    // participants.leave is NOT called directly — it's called by recordAgentExited
    const leaveCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([endpoint]) => endpoint === 'participants.leave'
    );
    expect(leaveCalls).toHaveLength(0);
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
    const openCodeService = ctx.agentServices.get('opencode')!;
    vi.spyOn(openCodeService, 'isAlive').mockReturnValue(false);

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

  it('kills both backend PID and diverged local PID when both are alive', async () => {
    // Backend records PID 1234, but local daemon state has PID 5678 (diverged).
    // Both must be killed.
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

    vi.mocked(deps.machine.listAgentEntries).mockReturnValue([
      {
        chatroomId: CHATROOM_ID,
        role: 'builder',
        entry: { pid: 5678, harness: 'opencode' },
      },
    ]);

    const openCodeService = ctx.agentServices.get('opencode')!;
    vi.spyOn(openCodeService, 'isAlive').mockReturnValue(true);

    // processes.kill: SIGTERM succeeds, kill(0) throws ESRCH (process died)
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
        if (signal === 0) throw new Error('ESRCH');
      }
    );

    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(false);
    // Both PIDs were killed — stops.mark called for each
    expect(deps.stops.mark).toHaveBeenCalledTimes(2);
    // Both PIDs sent SIGTERM to their process groups
    expect(deps.processes.kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    expect(deps.processes.kill).toHaveBeenCalledWith(-5678, 'SIGTERM');
  });

  it('kills local PID when backend has no recorded PID', async () => {
    // Backend has no PID, but local daemon state has one from a previous spawn.
    vi.mocked(deps.backend.query).mockResolvedValue({
      configs: [
        {
          machineId: 'test-machine',
          role: 'builder',
          spawnedAgentPid: undefined,
        },
      ],
    });

    vi.mocked(deps.machine.listAgentEntries).mockReturnValue([
      {
        chatroomId: CHATROOM_ID,
        role: 'builder',
        entry: { pid: 9999, harness: 'opencode' },
      },
    ]);

    const openCodeService = ctx.agentServices.get('opencode')!;
    vi.spyOn(openCodeService, 'isAlive').mockReturnValue(true);

    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
        if (signal === 0) throw new Error('ESRCH');
      }
    );

    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(false);
    expect(deps.processes.kill).toHaveBeenCalledWith(-9999, 'SIGTERM');
  });
});
