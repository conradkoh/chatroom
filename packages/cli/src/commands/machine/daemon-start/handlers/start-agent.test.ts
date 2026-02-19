/**
 * start-agent handler Unit Tests
 *
 * Tests handleStartAgent using injected dependencies.
 * Covers: no agent context, working dir validation, init prompt fetch,
 * driver resolution, successful spawn, PID persistence, start failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DaemonDeps } from '../deps.js';
import type { DaemonContext, StartAgentCommand } from '../types.js';
import { handleStartAgent } from './start-agent.js';

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
}): DaemonContext {
  const driverMock = options?.driver ?? createMockDriver();

  const deps: DaemonDeps = {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi
        .fn()
        .mockResolvedValue(
          options?.initPrompt !== undefined
            ? options.initPrompt
            : { prompt: 'test prompt', rolePrompt: 'role prompt', initialMessage: 'initial msg' }
        ),
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
});
