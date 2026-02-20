/**
 * start-agent handler Unit Tests
 *
 * Tests handleStartAgent using injected dependencies.
 * Covers: no agent context, working dir validation, init prompt fetch,
 * driver resolution, successful spawn, PID persistence, start failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';
import type { DaemonDeps } from '../deps.js';
import { DaemonEventBus } from '../event-bus.js';
import type { DaemonContext, StartAgentCommand } from '../types.js';
import { handleStartAgent } from './start-agent.js';
import { AgentOutputStore } from '../../../../stores/agent-output.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test:3210',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCommand(overrides?: Partial<StartAgentCommand['payload']>): StartAgentCommand {
  return {
    _id: 'cmd-1' as StartAgentCommand['_id'],
    createdAt: Date.now(),
    type: 'start-agent',
    payload: {
      chatroomId: 'test-chatroom-123' as StartAgentCommand['payload']['chatroomId'],
      role: 'builder',
      agentHarness: 'opencode',
      ...overrides,
    },
  };
}

function createMockDriver() {
  return {
    start: vi.fn().mockResolvedValue({
      success: true,
      handle: { pid: 5678 },
      onExit: vi.fn(),
      message: 'Agent started',
    }),
    stop: vi.fn(),
    isAlive: vi.fn(),
  };
}

function createMockContext(options?: {
  initPrompt?: { prompt: string; rolePrompt: string; initialMessage: string } | null;
  driver?: ReturnType<typeof createMockDriver>;
  desiredState?: { desiredStatus: string; requestedAt: number; requestedBy: string } | null;
  desiredStateError?: boolean;
}): DaemonContext {
  const driverMock = options?.driver ?? createMockDriver();

  const initPromptValue =
    options?.initPrompt !== undefined
      ? options.initPrompt
      : { prompt: 'test prompt', rolePrompt: 'role prompt', initialMessage: 'initial msg' };

  const desiredStateValue = options?.desiredState !== undefined ? options.desiredState : null;

  // Distinguish queries by their args: getDesiredState has no `convexUrl`,
  // while getInitPrompt includes `convexUrl`.
  const queryMock = vi.fn().mockImplementation((_fnRef: unknown, args: Record<string, unknown>) => {
    if (!args?.convexUrl) {
      if (options?.desiredStateError) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve(desiredStateValue);
    }
    return Promise.resolve(initPromptValue);
  });

  const deps: DaemonDeps = {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    },
    processes: {
      kill: vi.fn(),
      verifyPidOwnership: vi.fn().mockReturnValue(true),
    },
    drivers: {
      get: vi.fn().mockReturnValue(driverMock),
      all: vi.fn().mockReturnValue([]),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
    stops: {
      mark: vi.fn(),
      consume: vi.fn().mockReturnValue(false),
      clear: vi.fn(),
    },
    machine: {
      clearAgentPid: vi.fn(),
      persistAgentPid: vi.fn(),
      listAgentEntries: vi.fn().mockReturnValue([]),
    },
    clock: {
      now: vi.fn().mockReturnValue(Date.now()),
      delay: vi.fn().mockResolvedValue(undefined),
    },
  };

  return {
    client: {},
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    config: null,
    deps,
    events: new DaemonEventBus(),
    agentOutputStore: new AgentOutputStore(),
    remoteAgentService: new OpenCodeAgentService({
      execSync: vi.fn(),
      spawn: vi.fn() as any,
      kill: vi.fn(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleStartAgent', () => {
  it('returns failed when no workingDir in payload', async () => {
    const ctx = createMockContext();
    const cmd = createCommand();

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('No workingDir provided');
  });

  it('returns failed when working directory does not exist', async () => {
    const ctx = createMockContext();
    (ctx.deps.fs.stat as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ENOENT: no such file')
    );
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Working directory does not exist');
  });

  it('returns failed when working directory is not a directory', async () => {
    const ctx = createMockContext();
    (ctx.deps.fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
      isDirectory: () => false,
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('not a directory');
  });

  it('returns failed when init prompt fetch returns null', async () => {
    const ctx = createMockContext({ initPrompt: null });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Failed to fetch init prompt');
  });

  it('returns failed when no driver registered for harness', async () => {
    const ctx = createMockContext();
    (ctx.deps.drivers.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No driver registered');
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('No driver registered');
  });

  it('successfully spawns an agent and persists PID', async () => {
    const driver = createMockDriver();
    const ctx = createMockContext({ driver });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
    expect(result.result).toContain('PID: 5678');

    // Verify PID was persisted
    expect(ctx.deps.machine.persistAgentPid).toHaveBeenCalledWith(
      'test-machine-id',
      'test-chatroom-123',
      'builder',
      5678,
      'opencode'
    );

    // Verify backend was updated
    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(1);
  });

  it('emits agent:started event after successful spawn', async () => {
    const driver = createMockDriver();
    const ctx = createMockContext({ driver });
    const cmd = createCommand({ workingDir: '/tmp/test', model: 'gpt-4o' });

    const listener = vi.fn();
    ctx.events.on('agent:started', listener);

    await handleStartAgent(ctx, cmd);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'test-chatroom-123',
        role: 'builder',
        pid: 5678,
        harness: 'opencode',
        model: 'gpt-4o',
      })
    );
  });

  it('emits agent:exited event when process exits', async () => {
    let onExitCallback: ((code: number | null, signal: string | null) => void) | null = null;
    const driver = createMockDriver();
    driver.start.mockResolvedValue({
      success: true,
      handle: { pid: 5678 },
      onExit: (cb: (code: number | null, signal: string | null) => void) => {
        onExitCallback = cb;
      },
      message: 'Agent started',
    });
    const ctx = createMockContext({ driver });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const listener = vi.fn();
    ctx.events.on('agent:exited', listener);

    await handleStartAgent(ctx, cmd);

    expect(onExitCallback).not.toBeNull();
    onExitCallback!(1, 'SIGTERM');

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'test-chatroom-123',
        role: 'builder',
        pid: 5678,
        code: 1,
        signal: 'SIGTERM',
        intentional: false,
      })
    );
  });

  it('returns failed when driver.start fails', async () => {
    const driver = createMockDriver();
    driver.start.mockResolvedValue({
      success: false,
      handle: null,
      message: 'Failed to spawn process',
    });
    const ctx = createMockContext({ driver });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Failed to spawn process');
  });

  // ── Desired state validation tests ──────────────────────────────────

  it('discards start command when desired state is stopped', async () => {
    const ctx = createMockContext({
      desiredState: {
        desiredStatus: 'stopped',
        requestedAt: Date.now(),
        requestedBy: 'user',
      },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Discarded stale start-agent command');
    expect(result.result).toContain('stopped');
    expect(ctx.deps.drivers.get).not.toHaveBeenCalled();
  });

  it('proceeds normally when desired state is running', async () => {
    const driver = createMockDriver();
    const ctx = createMockContext({
      driver,
      desiredState: {
        desiredStatus: 'running',
        requestedAt: Date.now(),
        requestedBy: 'auto_restart',
      },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
  });

  it('proceeds normally when desired state query fails (fail-open)', async () => {
    const driver = createMockDriver();
    const ctx = createMockContext({
      driver,
      desiredStateError: true,
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
  });
});
