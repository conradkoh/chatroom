import { describe, expect, test, vi } from 'vitest';

import type { DaemonContext } from './types.js';
import type { Id } from '../../../api.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import { registerEventListeners } from '../../../events/daemon/register-listeners.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';

const CHATROOM_ID = 'test-chatroom' as Id<'chatroom_rooms'>;

function createTestContext(): DaemonContext {
  return {
    client: {},
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null,
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
    deps: {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(undefined),
      },
      processes: {
        kill: vi.fn(),
      },
      fs: {
        stat: vi.fn(),
      },
      machine: {
        clearAgentPid: vi.fn(),
        persistAgentPid: vi.fn(),
        listAgentEntries: vi.fn().mockReturnValue([]),
        persistEventCursor: vi.fn(),
        loadEventCursor: vi.fn().mockReturnValue(null),
      },
      clock: {
        now: () => Date.now(),
        delay: vi.fn().mockResolvedValue(undefined),
      },
      spawning: {
        shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
        recordSpawn: vi.fn(),
        recordExit: vi.fn(),
        getConcurrentCount: vi.fn().mockReturnValue(0),
      },
      agentProcessManager: {
        ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
        stop: vi.fn().mockResolvedValue({ success: true }),
        handleExit: vi.fn(),
        recover: vi.fn().mockResolvedValue(undefined),
        getSlot: vi.fn().mockReturnValue(undefined),
        listActive: vi.fn().mockReturnValue([]),
      } as any,
    },
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedAgents: null,
  };
}

describe('registerEventListeners', () => {
  test('agent:exited delegates to agentProcessManager.handleExit', () => {
    const ctx = createTestContext();
    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 1,
      signal: null,
      stopReason: 'agent_process.crashed',
    });

    expect(ctx.deps.agentProcessManager.handleExit).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 1,
      signal: null,
    });
  });

  test('agent:exited passes correct args for intentional stops', () => {
    const ctx = createTestContext();
    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
      stopReason: 'user.stop',
    });

    expect(ctx.deps.agentProcessManager.handleExit).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
    });
  });

  test('unsubscribe removes all listeners', () => {
    const ctx = createTestContext();
    const unsubscribe = registerEventListeners(ctx);

    unsubscribe();

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
      stopReason: 'agent_process.exited_clean',
    });

    expect(ctx.deps.agentProcessManager.handleExit).not.toHaveBeenCalled();
  });

  test('agent:exited handles natural process exit (code 0)', () => {
    const ctx = createTestContext();
    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 9999,
      code: 0,
      signal: null,
      stopReason: 'agent_process.exited_clean',
    });

    expect(ctx.deps.agentProcessManager.handleExit).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 9999,
      code: 0,
      signal: null,
    });
  });

  test('agent:exited passes signal information', () => {
    const ctx = createTestContext();
    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 5555,
      code: null,
      signal: 'SIGTERM',
      stopReason: 'agent_process.signal',
    });

    expect(ctx.deps.agentProcessManager.handleExit).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 5555,
      code: null,
      signal: 'SIGTERM',
    });
  });
});
