import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { DaemonAgentProcessManagerService, DaemonSessionService } from './daemon-services.js';
import type { DaemonSessionInit, ConvexClient } from './daemon-types.js';
import type { Id } from '../../api.js';
import { registerEventListenersEffect } from './events/register-listeners.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { OpenCodeAgentService } from '../infrastructure/local/harness/services/opencode/index.js';

const CHATROOM_ID = 'test-chatroom' as Id<'chatroom_rooms'>;

function createTestInit() {
  const agentProcessManager = {
    ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    handleExit: vi.fn().mockResolvedValue(undefined),
    getSlot: vi.fn().mockReturnValue(undefined),
    listActive: vi.fn().mockReturnValue([]),
    clearStuckStoppingSlot: vi.fn().mockResolvedValue(false),
  } as any;

  return createMockDaemonSessionInit({
    sessionId: 'test-session',
    machineId: 'test-machine',
    agentServices: new Map([
      [
        'opencode',
        new OpenCodeAgentService({ execSync: vi.fn(), spawn: vi.fn() as any, kill: vi.fn() }),
      ],
    ]),
    agentProcessManager,
  });
}

function registerListeners(
  init: Pick<DaemonSessionInit, 'events' | 'agentProcessManager'>
): () => void {
  return Effect.runSync(
    registerEventListenersEffect().pipe(
      Effect.provideService(DaemonSessionService, {
        sessionId: 'test',
        machineId: 'test',
        convexUrl: 'http://test:3210',
        client: {} as ConvexClient,
        config: null,
        backend: {} as any,
        fs: {} as any,
        agentServices: new Map(),
        events: init.events,
        lastPushedGitState: new Map(),
        lastPushedModels: null,
        lastPushedHarnessFingerprint: null,
        logEvent: async () => undefined,
        taskService: {} as never,
        agentConfigRegistry: { get: () => undefined } as never,
      }),
      Effect.provideService(DaemonAgentProcessManagerService, {
        handleExit: (opts) => Effect.sync(() => init.agentProcessManager.handleExit(opts)),
        ensureRunning: (opts) => Effect.promise(() => init.agentProcessManager.ensureRunning(opts)),
        stop: (opts) => Effect.promise(() => init.agentProcessManager.stop(opts)),
        getSlot: (chatroomId, role) => init.agentProcessManager.getSlot(chatroomId, role),
        isStopRequested: (chatroomId, role) =>
          init.agentProcessManager.isStopRequested(chatroomId, role),
        listActive: () => init.agentProcessManager.listActive(),
        clearStuckStoppingSlot: (chatroomId, role) =>
          Effect.promise(
            () =>
              init.agentProcessManager.clearStuckStoppingSlot?.(chatroomId, role) ??
              Promise.resolve(false)
          ),
        whenTurnEndsIdle: () => Effect.promise(() => init.agentProcessManager.whenTurnEndsIdle()),
        resumeTurnForSlot: (args) =>
          Effect.promise(() => init.agentProcessManager.resumeTurnForSlot(args)),
        subscribeAgentTurnEnded: () => () => undefined,
        subscribeAgentStarted: () => () => undefined,
        subscribeAgentSessionLost: () => () => undefined,
        subscribeAgentTurnProgress: () => () => undefined,
      })
    )
  );
}

describe('registerEventListeners', () => {
  test('registrations stay isolated and can unsubscribe independently after registration returns', async () => {
    const initA = createTestInit();
    const initB = createTestInit();
    const unsubscribeA = registerListeners(initA);
    const unsubscribeB = registerListeners(initB);
    let subscribedA = true;
    const eventA = {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 4101,
      code: 7,
      signal: null,
      stopReason: 'agent_process.crashed',
    } as const;
    const eventB = {
      chatroomId: 'other-chatroom' as Id<'chatroom_rooms'>,
      role: 'reviewer',
      pid: 5202,
      code: null,
      signal: 'SIGTERM',
      stopReason: 'agent_process.signal',
    } as const;

    try {
      initA.events.emit('agent:exited', eventA);
      await vi.waitFor(() => {
        expect(initA.agentProcessManager.handleExit).toHaveBeenCalledWith({
          chatroomId: eventA.chatroomId,
          role: eventA.role,
          pid: eventA.pid,
          code: eventA.code,
          signal: eventA.signal,
        });
      });
      expect(initB.agentProcessManager.handleExit).not.toHaveBeenCalled();

      unsubscribeA();
      subscribedA = false;
      initA.events.emit('agent:exited', { ...eventA, pid: 4102 });
      initB.events.emit('agent:exited', eventB);
      await vi.waitFor(() => {
        expect(initB.agentProcessManager.handleExit).toHaveBeenCalledWith({
          chatroomId: eventB.chatroomId,
          role: eventB.role,
          pid: eventB.pid,
          code: eventB.code,
          signal: eventB.signal,
        });
      });
      expect(initA.agentProcessManager.handleExit).toHaveBeenCalledTimes(1);
      expect(initB.agentProcessManager.handleExit).toHaveBeenCalledTimes(1);
    } finally {
      if (subscribedA) unsubscribeA();
      unsubscribeB();
    }
  });

  test('agent:exited delegates to agentProcessManager.handleExit', async () => {
    const init = createTestInit();
    const unsubscribe = registerListeners(init);

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 1,
      signal: null,
      stopReason: 'agent_process.crashed',
    });

    await vi.waitFor(() => {
      expect(init.agentProcessManager.handleExit).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        pid: 1234,
        code: 1,
        signal: null,
      });
    });

    unsubscribe();
  });

  test('agent:exited passes correct args for intentional stops', async () => {
    const init = createTestInit();
    const unsubscribe = registerListeners(init);

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
      stopReason: 'user.stop',
    });

    await vi.waitFor(() => {
      expect(init.agentProcessManager.handleExit).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        pid: 1234,
        code: 0,
        signal: null,
      });
    });

    unsubscribe();
  });

  test('unsubscribe removes all listeners', () => {
    const init = createTestInit();
    const unsubscribe = registerListeners(init);

    unsubscribe();

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
      stopReason: 'agent_process.exited_clean',
    });

    expect(init.agentProcessManager.handleExit).not.toHaveBeenCalled();
  });

  test('agent:exited handles natural process exit (code 0)', async () => {
    const init = createTestInit();
    const unsubscribe = registerListeners(init);

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 9999,
      code: 0,
      signal: null,
      stopReason: 'agent_process.exited_clean',
    });

    await vi.waitFor(() => {
      expect(init.agentProcessManager.handleExit).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        pid: 9999,
        code: 0,
        signal: null,
      });
    });

    unsubscribe();
  });

  test('agent:exited passes signal information', async () => {
    const init = createTestInit();
    const unsubscribe = registerListeners(init);

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 5555,
      code: null,
      signal: 'SIGTERM',
      stopReason: 'agent_process.signal',
    });

    await vi.waitFor(() => {
      expect(init.agentProcessManager.handleExit).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        pid: 5555,
        code: null,
        signal: 'SIGTERM',
      });
    });

    unsubscribe();
  });
});
