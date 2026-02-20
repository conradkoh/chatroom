/**
 * start-agent handler Unit Tests
 *
 * Tests handleStartAgent using injected dependencies.
 * Covers: no agent context, working dir validation, init prompt fetch,
 * spawn via RemoteAgentService, successful spawn, PID persistence, spawn failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteAgentService } from '../../../../infrastructure/services/remote-agents/remote-agent-service.js';
import type { DaemonDeps } from '../deps.js';
import { DaemonEventBus } from '../event-bus.js';
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

function createMockContext(options?: {
  initPrompt?: { prompt: string; rolePrompt: string; initialMessage: string } | null;
  spawnResult?: {
    pid: number;
    onExit: (
      cb: (info: {
        code: number | null;
        signal: string | null;
        context: { machineId: string; chatroomId: string; role: string };
      }) => void
    ) => void;
    onOutput: (cb: () => void) => void;
  };
  spawnError?: Error;
  lifecycleState?: { state: string } | null;
  lifecycleError?: boolean;
}): DaemonContext {
  const spawnMock = vi.fn().mockImplementation(async () => {
    if (options?.spawnError) throw options.spawnError;
    if (options?.spawnResult) return options.spawnResult;
    return {
      pid: 5678,
      onExit: vi.fn(),
      onOutput: vi.fn(),
    };
  });

  const initPromptValue =
    options?.initPrompt !== undefined
      ? options.initPrompt
      : { prompt: 'test prompt', rolePrompt: 'role prompt', initialMessage: 'initial msg' };

  const lifecycleValue = options?.lifecycleState !== undefined ? options.lifecycleState : null;

  // Distinguish queries: getStatus has no `convexUrl`, getInitPrompt includes `convexUrl`.
  const queryMock = vi.fn().mockImplementation((_fnRef: unknown, args: Record<string, unknown>) => {
    if (!args?.convexUrl) {
      if (options?.lifecycleError) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve(lifecycleValue);
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

  const remoteAgentService = {
    spawn: spawnMock,
    stop: vi.fn(),
    isAlive: vi.fn().mockReturnValue(true),
    getTrackedProcesses: vi.fn().mockReturnValue([]),
    getIdleProcesses: vi.fn().mockReturnValue([]),
    untrack: vi.fn(),
  } as unknown as RemoteAgentService;

  return {
    client: {},
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    config: null,
    deps,
    events: new DaemonEventBus(),
    remoteAgentService,
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

  it('returns failed when spawn throws', async () => {
    const ctx = createMockContext({ spawnError: new Error('No driver registered') });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('No driver registered');
  });

  it('successfully spawns an agent and persists PID', async () => {
    const ctx = createMockContext();
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

    // Verify backend was updated (updateSpawnedAgent + lifecycle.transition)
    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(2);
  });

  it('emits agent:started event after successful spawn', async () => {
    const ctx = createMockContext();
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
    let onExitCallback:
      | ((info: {
          code: number | null;
          signal: string | null;
          context: { machineId: string; chatroomId: string; role: string };
        }) => void)
      | null = null;
    const ctx = createMockContext({
      spawnResult: {
        pid: 5678,
        onExit: (cb) => {
          onExitCallback = cb;
        },
        onOutput: vi.fn(),
      },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const listener = vi.fn();
    ctx.events.on('agent:exited', listener);

    await handleStartAgent(ctx, cmd);

    expect(onExitCallback).not.toBeNull();
    onExitCallback!({
      code: 1,
      signal: 'SIGTERM',
      context: { machineId: 'test-machine-id', chatroomId: 'test-chatroom-123', role: 'builder' },
    });

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

  it('returns failed when spawn throws with message', async () => {
    const ctx = createMockContext({
      spawnError: new Error('Failed to spawn process'),
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Failed to spawn process');
  });

  // ── Lifecycle validation tests ──────────────────────────────────────

  it('discards start command when lifecycle is stop_requested', async () => {
    const ctx = createMockContext({
      lifecycleState: { state: 'stop_requested' },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Discarded stale start-agent command');
    expect(result.result).toContain('stop_requested');
    expect(ctx.remoteAgentService.spawn).not.toHaveBeenCalled();
  });

  it('discards start command when lifecycle is stopping', async () => {
    const ctx = createMockContext({
      lifecycleState: { state: 'stopping' },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Discarded stale start-agent command');
    expect(result.result).toContain('stopping');
    expect(ctx.remoteAgentService.spawn).not.toHaveBeenCalled();
  });

  it('skips redundant start when agent is already ready', async () => {
    const ctx = createMockContext({
      lifecycleState: { state: 'ready' },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('already alive');
    expect(result.result).toContain('ready');
    expect(ctx.remoteAgentService.spawn).not.toHaveBeenCalled();
  });

  it('skips redundant start when agent is already working', async () => {
    const ctx = createMockContext({
      lifecycleState: { state: 'working' },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('already alive');
    expect(result.result).toContain('working');
    expect(ctx.remoteAgentService.spawn).not.toHaveBeenCalled();
  });

  it('proceeds normally when lifecycle is start_requested', async () => {
    const ctx = createMockContext({
      lifecycleState: { state: 'start_requested' },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
  });

  it('proceeds normally when no lifecycle record exists', async () => {
    const ctx = createMockContext({
      lifecycleState: null,
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
  });

  it('proceeds normally when lifecycle query fails (fail-open)', async () => {
    const ctx = createMockContext({
      lifecycleError: true,
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
  });
});
