import { describe, expect, test, vi } from 'vitest';

import { DaemonEventBus } from './event-bus.js';
import { registerEventListeners } from './event-listeners.js';
import type { DaemonContext } from './types.js';
import type { Id } from '../../../api.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';
import { AgentOutputStore } from '../../../stores/agent-output.js';

const CHATROOM_ID = 'test-chatroom' as Id<'chatroom_rooms'>;

function createTestContext(): DaemonContext {
  return {
    client: {},
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null,
    events: new DaemonEventBus(),
    agentOutputStore: new AgentOutputStore(),
    remoteAgentService: new OpenCodeAgentService({
      execSync: vi.fn(),
      spawn: vi.fn() as any,
      kill: vi.fn(),
    }),
    deps: {
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
        stat: vi.fn(),
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
        now: () => Date.now(),
        delay: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

describe('registerEventListeners', () => {
  test('agent:exited clears PID from backend and local state', async () => {
    const ctx = createTestContext();
    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 1,
      signal: null,
      intentional: false,
    });

    // Allow microtasks to flush
    await vi.waitFor(() => {
      expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
        expect.objectContaining({}),
        expect.objectContaining({
          chatroomId: CHATROOM_ID,
          role: 'builder',
          pid: undefined,
        })
      );
    });

    expect(ctx.deps.machine.clearAgentPid).toHaveBeenCalledWith(
      'test-machine',
      CHATROOM_ID,
      'builder'
    );
  });

  test('agent:exited removes participant record', async () => {
    const ctx = createTestContext();
    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
      intentional: true,
    });

    await vi.waitFor(() => {
      const calls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
      const leaveCall = calls.find(
        (c) =>
          c[1]?.role === 'builder' && c[1]?.chatroomId === CHATROOM_ID && c[1]?.pid === undefined
      );
      expect(leaveCall).toBeDefined();
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
      intentional: false,
    });

    expect(ctx.deps.backend.mutation).not.toHaveBeenCalled();
    expect(ctx.deps.machine.clearAgentPid).not.toHaveBeenCalled();
  });

  test('agent:exited handles backend errors gracefully', async () => {
    const ctx = createTestContext();
    const warnSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network error')
    );

    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 1,
      signal: null,
      intentional: false,
    });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clear PID in backend')
      );
    });

    warnSpy.mockRestore();
  });
});
