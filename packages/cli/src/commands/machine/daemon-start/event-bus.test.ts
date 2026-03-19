import { describe, expect, test, vi } from 'vitest';

import type { Id } from '../../../api.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';

const CHATROOM_ID = 'test-chatroom' as Id<'chatroom_rooms'>;

describe('DaemonEventBus', () => {
  test('emits events to registered listeners', () => {
    const bus = new DaemonEventBus();
    const listener = vi.fn();

    bus.on('agent:started', listener);
    bus.emit('agent:started', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      harness: 'opencode',
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      harness: 'opencode',
    });
  });

  test('supports multiple listeners for the same event', () => {
    const bus = new DaemonEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.on('agent:exited', listener1);
    bus.on('agent:exited', listener2);
    bus.emit('agent:exited', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      code: 0,
      signal: null,
      stopReason: 'user.stop',
    });

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  test('unsubscribe removes the listener', () => {
    const bus = new DaemonEventBus();
    const listener = vi.fn();

    const unsubscribe = bus.on('command:completed', listener);
    unsubscribe();
    bus.emit('command:completed', {
      commandId: 'cmd-1',
      type: 'ping',
      failed: false,
      result: 'pong',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  test('does not call listeners for other events', () => {
    const bus = new DaemonEventBus();
    const listener = vi.fn();

    bus.on('agent:started', listener);
    bus.emit('agent:stopped', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  test('catches and logs listener errors without breaking other listeners', () => {
    const bus = new DaemonEventBus();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const goodListener = vi.fn();

    bus.on('command:processing', () => {
      throw new Error('listener boom');
    });
    bus.on('command:processing', goodListener);

    bus.emit('command:processing', { commandId: 'cmd-1', type: 'ping' });

    expect(goodListener).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Listener error on "command:processing"')
    );

    warnSpy.mockRestore();
  });

  test('removeAllListeners clears everything', () => {
    const bus = new DaemonEventBus();
    const listener = vi.fn();

    bus.on('agent:started', listener);
    bus.removeAllListeners();
    bus.emit('agent:started', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
      harness: 'opencode',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  test('emitting with no listeners is a no-op', () => {
    const bus = new DaemonEventBus();
    // Should not throw
    bus.emit('agent:stopped', {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      pid: 1234,
    });
  });
});
