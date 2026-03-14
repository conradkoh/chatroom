import { describe, expect, test, vi } from 'vitest';

import { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import { registerEventListeners } from '../../../events/daemon/register-listeners.js';
import type { DaemonContext } from './types.js';
import type { Id } from '../../../api.js';
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
      stops: {
        mark: vi.fn(),
        consume: vi.fn().mockReturnValue(false),
        clear: vi.fn(),
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
    },
    activeWorkingDirs: new Set(),
      lastPushedGitState: new Map(),
  };
}

describe('registerEventListeners', () => {
  test('agent:exited calls recordAgentExited and clears local state', async () => {
    const ctx = createTestContext();
    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 1,
      signal: null,
      stopReason: 'agent_process.crashed',
      intentional: false,
    });

    // Allow microtasks to flush
    await vi.waitFor(() => {
      expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
        expect.objectContaining({}),
        expect.objectContaining({
          chatroomId: CHATROOM_ID,
          role: 'builder',
          pid: 1234,
          intentional: false,
        })
      );
    });

    expect(ctx.deps.machine.clearAgentPid).toHaveBeenCalledWith(
      'test-machine',
      CHATROOM_ID,
      'builder'
    );
  });

  test('agent:exited passes intentional=true for intentional stops', async () => {
    const ctx = createTestContext();
    registerEventListeners(ctx);

    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
      stopReason: 'user.stop',
      intentional: true,
    });

    await vi.waitFor(() => {
      const calls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
      const recordCall = calls.find(
        (c) =>
          c[1]?.role === 'builder' && c[1]?.chatroomId === CHATROOM_ID && c[1]?.intentional === true
      );
      expect(recordCall).toBeDefined();
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
      stopReason: 'agent_process.crashed',
      intentional: false,
    });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record agent exit event')
      );
    });

    warnSpy.mockRestore();
  });

  test('natural process exit (code 0, no explicit stop) is treated as unintentional and triggers crash recovery', async () => {
    // DESIGN DECISION: The system does not distinguish between a natural completion
    // and an unexpected crash. Any process exit without a prior explicit stop command
    // (via agent.requestStop) is treated as unintentional — intentional=false.
    //
    // Known trade-off: if an agent finishes work and exits cleanly before the handoff
    // mutation completes, the ensure-agent handler may fire and attempt a restart.
    // This may result in a wasted agent start request. This is an intentional
    // reliability choice: the system prefers restarting unnecessarily over leaving a
    // task stuck with no agent to handle it.
    const ctx = createTestContext();
    registerEventListeners(ctx);

    // Simulate a natural exit: code 0, no signal, no prior stops.mark() call
    // stops.consume() returns false (default mock) — no explicit stop was issued
    ctx.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 9999,
      code: 0, // ← natural exit code (not a crash)
      signal: null,
      stopReason: 'agent_process.exited_clean',
      intentional: false, // ← no prior stops.mark() — treated as unintentional
    });

    await vi.waitFor(() => {
      expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
        expect.objectContaining({}),
        expect.objectContaining({
          chatroomId: CHATROOM_ID,
          role: 'builder',
          pid: 9999,
          intentional: false, // ← crash recovery will fire on backend
        })
      );
    });
  });
});
