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

import { processCommand } from './command-loop.js';
import type { DaemonDeps } from './deps.js';
import { DaemonEventBus } from './event-bus.js';
import type {
  DaemonContext,
  PingCommand,
  StatusCommand,
  StartAgentCommand,
  StopAgentCommand,
} from './types.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';
import { AgentOutputStore } from '../../../stores/agent-output.js';

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
      verifyPidOwnership: vi.fn().mockReturnValue(true),
    },
    drivers: {
      get: vi.fn(),
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
