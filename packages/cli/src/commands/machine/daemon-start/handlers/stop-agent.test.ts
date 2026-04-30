/**
 * Stop Agent Handler Tests
 *
 * Tests for handleStopAgent — delegates to AgentProcessManager.stop().
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../../../../api.js';
import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';
import type { DaemonDeps } from '../deps.js';
import { createMockDaemonDeps } from '../testing/index.js';
import type { DaemonContext, StopAgentCommand } from '../types.js';

// ---------------------------------------------------------------------------
// Mock module-level imports
// ---------------------------------------------------------------------------

vi.mock('../../../../api.js', () => ({
  api: {
    machines: {
      updateSpawnedAgent: 'machines.updateSpawnedAgent',
      getMachineAgentConfigs: 'machines.getMachineAgentConfigs',
      recordAgentExited: 'machines.recordAgentExited',
    },
    participants: {
      leave: 'participants.leave',
    },
  },
}));

// ---------------------------------------------------------------------------
// Import the function under test (after mocks are set up)
// ---------------------------------------------------------------------------

const { handleStopAgent, executeStopAgent } = await import('./stop-agent.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHATROOM_ID = 'test-chatroom-123' as Id<'chatroom_rooms'>;

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
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
  };
}

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
    deps = createMockDaemonDeps();
    ctx = createCtx(deps);
  });

  it('delegates to agentProcessManager.stop with correct args', async () => {
    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent stopped');
    expect(deps.agentProcessManager.stop).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      reason: 'test',
    });
  });

  it('returns failure when manager.stop fails', async () => {
    vi.mocked(deps.agentProcessManager.stop).mockResolvedValue({ success: false });

    const result = await handleStopAgent(ctx, createStopCommand());

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Failed to stop');
  });

  it('passes through the reason from the command', async () => {
    const command: StopAgentCommand = {
      type: 'stop-agent',
      reason: 'user.stop',
      payload: {
        chatroomId: CHATROOM_ID,
        role: 'reviewer',
      },
    };

    await handleStopAgent(ctx, command);

    expect(deps.agentProcessManager.stop).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'reviewer',
      reason: 'user.stop',
    });
  });

  it('passes through pid from executeStopAgent to agentProcessManager.stop', async () => {
    await executeStopAgent(ctx, {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      reason: 'user.stop',
      pid: 12345,
    });

    expect(deps.agentProcessManager.stop).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      reason: 'user.stop',
      pid: 12345,
    });
  });

  it('does not include pid when not provided to executeStopAgent', async () => {
    await executeStopAgent(ctx, {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      reason: 'user.stop',
    });

    expect(deps.agentProcessManager.stop).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      reason: 'user.stop',
      pid: undefined,
    });
  });
});
