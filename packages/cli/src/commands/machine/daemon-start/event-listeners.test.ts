import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { DaemonAgentProcessManagerService, DaemonSessionService } from './daemon-services.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import type { DaemonSessionInit } from './types.js';
import type { Id } from '../../../api.js';
import { registerEventListenersEffect } from '../../../events/daemon/register-listeners.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';

const CHATROOM_ID = 'test-chatroom' as Id<'chatroom_rooms'>;

function createTestInit() {
  const agentProcessManager = {
    ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    handleExit: vi.fn().mockResolvedValue(undefined),
    recover: vi.fn().mockResolvedValue(undefined),
    getSlot: vi.fn().mockReturnValue(undefined),
    listActive: vi.fn().mockReturnValue([]),
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
        client: {},
        config: null,
        backend: {} as any,
        fs: {} as any,
        agentServices: new Map(),
        events: init.events,
        lastPushedGitState: new Map(),
        lastPushedModels: null,
        lastPushedHarnessFingerprint: null,
      }),
      Effect.provideService(DaemonAgentProcessManagerService, {
        handleExit: (opts) => Effect.promise(() => init.agentProcessManager.handleExit(opts)),
        ensureRunning: (opts) => Effect.promise(() => init.agentProcessManager.ensureRunning(opts)),
        stop: (opts) => Effect.promise(() => init.agentProcessManager.stop(opts)),
        recover: () => Effect.promise(() => init.agentProcessManager.recover()),
        getSlot: (chatroomId, role) => init.agentProcessManager.getSlot(chatroomId, role),
        listActive: () => init.agentProcessManager.listActive(),
        whenTurnEndsIdle: () => Effect.promise(() => init.agentProcessManager.whenTurnEndsIdle()),
      })
    )
  );
}

describe('registerEventListeners', () => {
  test('agent:exited delegates to agentProcessManager.handleExit', () => {
    const init = createTestInit();
    registerListeners(init);

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 1,
      signal: null,
      stopReason: 'agent_process.crashed',
    });

    expect(init.agentProcessManager.handleExit).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 1,
      signal: null,
    });
  });

  test('agent:exited passes correct args for intentional stops', () => {
    const init = createTestInit();
    registerListeners(init);

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
      stopReason: 'user.stop',
    });

    expect(init.agentProcessManager.handleExit).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
    });
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

  test('agent:exited handles natural process exit (code 0)', () => {
    const init = createTestInit();
    registerListeners(init);

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 9999,
      code: 0,
      signal: null,
      stopReason: 'agent_process.exited_clean',
    });

    expect(init.agentProcessManager.handleExit).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 9999,
      code: 0,
      signal: null,
    });
  });

  test('agent:exited passes signal information', () => {
    const init = createTestInit();
    registerListeners(init);

    init.events.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 5555,
      code: null,
      signal: 'SIGTERM',
      stopReason: 'agent_process.signal',
    });

    expect(init.agentProcessManager.handleExit).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 5555,
      code: null,
      signal: 'SIGTERM',
    });
  });
});
