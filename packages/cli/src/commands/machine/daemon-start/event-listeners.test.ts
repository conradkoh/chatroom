import { describe, expect, test, vi } from 'vitest';

import { createMockDaemonSessionInit } from './testing/index.js';
import type { DaemonSessionInit } from './types.js';
import type { Id } from '../../../api.js';
import { registerEventListenersCore } from '../../../events/daemon/register-listeners.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';

const CHATROOM_ID = 'test-chatroom' as Id<'chatroom_rooms'>;

function createTestInit() {
  const agentProcessManager = {
    ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    handleExit: vi.fn(),
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
  return registerEventListenersCore({
    events: init.events,
    handleExit: (opts) => init.agentProcessManager.handleExit(opts),
  });
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
