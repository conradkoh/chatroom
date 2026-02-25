/**
 * command-loop Unit Tests
 *
 * Tests the processCommand dispatch function using injected dependencies.
 * Covers: ping dispatch, status dispatch, start-agent dispatch,
 * stop-agent dispatch, ack processing/completed/failed, error handling.
 *
 * Note: startCommandLoop is not tested here because it involves
 * WebSocket subscriptions, timers, and signal handlers. The individual
 * handlers it dispatches to are tested in their own test files.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processCommand, refreshModels } from './command-loop.js';
import type { DaemonDeps } from './deps.js';
import { DaemonEventBus } from './event-bus.js';
import type {
  DaemonContext,
  AgentHarness,
  PingCommand,
  StatusCommand,
  StartAgentCommand,
  StopAgentCommand,
} from './types.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';
import { PiAgentService } from '../../../infrastructure/services/remote-agents/pi/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./handlers/ping.js', () => ({
  handlePing: vi.fn().mockReturnValue({ result: 'pong', failed: false }),
}));

vi.mock('./handlers/status.js', () => ({
  handleStatus: vi.fn().mockReturnValue({ result: '{"hostname":"test"}', failed: false }),
}));

vi.mock('./handlers/start-agent.js', () => ({
  handleStartAgent: vi.fn().mockResolvedValue({ result: 'Agent spawned', failed: false }),
}));

vi.mock('./handlers/stop-agent.js', () => ({
  handleStopAgent: vi.fn().mockResolvedValue({ result: 'Agent stopped', failed: false }),
}));

vi.mock('../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test:3210',
  getConvexWsClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(): DaemonContext {
  const deps: DaemonDeps = {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
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

  return {
    client: {},
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    config: null,
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

function createPingCommand(): PingCommand {
  return {
    _id: 'cmd-ping' as PingCommand['_id'],
    createdAt: Date.now(),
    type: 'ping',
    payload: {},
  };
}

function createStatusCommand(): StatusCommand {
  return {
    _id: 'cmd-status' as StatusCommand['_id'],
    createdAt: Date.now(),
    type: 'status',
    payload: {},
  };
}

function createStartAgentCommand(): StartAgentCommand {
  return {
    _id: 'cmd-start' as StartAgentCommand['_id'],
    createdAt: Date.now(),
    type: 'start-agent',
    payload: {
      chatroomId: 'room-1' as StartAgentCommand['payload']['chatroomId'],
      role: 'builder',
      agentHarness: 'opencode',
    },
  };
}

function createStopAgentCommand(): StopAgentCommand {
  return {
    _id: 'cmd-stop' as StopAgentCommand['_id'],
    createdAt: Date.now(),
    type: 'stop-agent',
    payload: {
      chatroomId: 'room-1' as StopAgentCommand['payload']['chatroomId'],
      role: 'builder',
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processCommand', () => {
  it('dispatches ping command and acks as completed', async () => {
    const ctx = createMockContext();
    const cmd = createPingCommand();

    await processCommand(ctx, cmd);

    // Should ack as processing, then as completed
    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(2);

    // First call: ack as processing
    expect(ctx.deps.backend.mutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      sessionId: 'test-session-id',
      commandId: 'cmd-ping',
      status: 'processing',
    });

    // Second call: ack as completed with result
    expect(ctx.deps.backend.mutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      sessionId: 'test-session-id',
      commandId: 'cmd-ping',
      status: 'completed',
      result: 'pong',
    });
  });

  it('dispatches status command', async () => {
    const ctx = createMockContext();
    const cmd = createStatusCommand();

    await processCommand(ctx, cmd);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(2);
    expect(ctx.deps.backend.mutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      sessionId: 'test-session-id',
      commandId: 'cmd-status',
      status: 'completed',
      result: '{"hostname":"test"}',
    });
  });

  it('dispatches start-agent command', async () => {
    const ctx = createMockContext();
    const cmd = createStartAgentCommand();

    await processCommand(ctx, cmd);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(2);
    expect(ctx.deps.backend.mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        status: 'completed',
        result: 'Agent spawned',
      })
    );
  });

  it('dispatches stop-agent command', async () => {
    const ctx = createMockContext();
    const cmd = createStopAgentCommand();

    await processCommand(ctx, cmd);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(2);
    expect(ctx.deps.backend.mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        status: 'completed',
        result: 'Agent stopped',
      })
    );
  });

  it('acks as failed when handler returns failed=true', async () => {
    const { handleStartAgent } = await import('./handlers/start-agent.js');
    vi.mocked(handleStartAgent).mockResolvedValueOnce({
      result: 'No agent context found',
      failed: true,
    });

    const ctx = createMockContext();
    const cmd = createStartAgentCommand();

    await processCommand(ctx, cmd);

    expect(ctx.deps.backend.mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        status: 'failed',
        result: 'No agent context found',
      })
    );
  });

  it('acks as failed when handler throws an error', async () => {
    const { handleStopAgent } = await import('./handlers/stop-agent.js');
    vi.mocked(handleStopAgent).mockRejectedValueOnce(new Error('Unexpected crash'));

    const ctx = createMockContext();
    const cmd = createStopAgentCommand();

    await processCommand(ctx, cmd);

    // Should attempt to ack as failed (3 mutation calls: processing, fail ack)
    // The error triggers a catch block that tries to ack as failed
    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'failed',
        result: 'Unexpected crash',
      })
    );
  });
});

// ---------------------------------------------------------------------------
// refreshModels
// ---------------------------------------------------------------------------

describe('refreshModels', () => {
  function createContextWithServices(
    services: Array<{ harness: AgentHarness; isInstalled: boolean; models: string[] | Error }>
  ): DaemonContext {
    const agentServices = new Map<AgentHarness, RemoteAgentService>(
      services.map(({ harness, isInstalled: installed, models }) => [
        harness,
        {
          isInstalled: vi.fn().mockReturnValue(installed),
          listModels:
            models instanceof Error
              ? vi.fn().mockRejectedValue(models)
              : vi.fn().mockResolvedValue(models),
        } as unknown as RemoteAgentService,
      ])
    );

    const deps: DaemonDeps = {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(undefined),
      },
      processes: { kill: vi.fn() },
      fs: { stat: vi.fn() as any },
      stops: { mark: vi.fn(), consume: vi.fn().mockReturnValue(false), clear: vi.fn() },
      machine: {
        clearAgentPid: vi.fn(),
        persistAgentPid: vi.fn(),
        listAgentEntries: vi.fn().mockReturnValue([]),
      },
      clock: { now: vi.fn().mockReturnValue(Date.now()), delay: vi.fn().mockResolvedValue(undefined) },
    };

    return {
      client: {} as any,
      sessionId: 'test-session-id',
      machineId: 'test-machine-id',
      config: {
        machineId: 'test-machine-id',
        hostname: 'test-host',
        os: 'darwin',
        registeredAt: '2026-01-01T00:00:00Z',
        lastSyncedAt: '2026-01-01T00:00:00Z',
        availableHarnesses: ['opencode', 'pi'],
        harnessVersions: {},
      },
      deps,
      events: new DaemonEventBus(),
      agentServices,
    };
  }

  it('discovers models from all installed harnesses', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a', 'opencode/model-b'] },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/claude-sonnet-4.5'] },
    ]);

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        availableModels: {
          opencode: ['opencode/model-a', 'opencode/model-b'],
          pi: ['github-copilot/claude-sonnet-4.5'],
        },
      })
    );
  });

  it('skips harnesses that are not installed — does not write empty entry', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
      { harness: 'pi', isInstalled: false, models: [] },
    ]);

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        availableModels: {
          opencode: ['opencode/model-a'],
          // pi must NOT be present — was not installed
        },
      })
    );
    const call = vi.mocked(ctx.deps.backend.mutation).mock.calls[0][1] as any;
    expect(call.availableModels).not.toHaveProperty('pi');
  });

  it('skips harness entry when listModels throws (non-critical error)', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: new Error('opencode broke') },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/gpt-4o'] },
    ]);

    await refreshModels(ctx);

    const call = vi.mocked(ctx.deps.backend.mutation).mock.calls[0][1] as any;
    // opencode failed so it should be absent; pi succeeded
    expect(call.availableModels).not.toHaveProperty('opencode');
    expect(call.availableModels).toEqual({ pi: ['github-copilot/gpt-4o'] });
  });

  it('does not call mutation when config is null', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
    ]);
    ctx.config = null;

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).not.toHaveBeenCalled();
  });

  it('warns but does not throw when mutation fails', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
    ]);
    vi.mocked(ctx.deps.backend.mutation).mockRejectedValueOnce(new Error('network error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(refreshModels(ctx)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Model refresh failed'));
  });
});
