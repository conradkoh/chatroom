import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  commandInboundReadiness,
  dispatchCommandInboundEvent,
  registerCommandInboundHandler,
  unregisterCommandInboundHandler,
} from './command-inbound-registry.js';
import type { CommandInboundEvent } from '../domain/usecase/handle-command-inbound.js';

const EVENT = {
  type: 'command.received',
  commandId: 'cmd-1',
  claimedCommand: { commandId: 'cmd-1', type: 'daemon.ping' },
} as unknown as CommandInboundEvent;

afterEach(() => unregisterCommandInboundHandler());

describe('command-inbound readiness', () => {
  it('is ready only while a handler is registered, and ready listeners fire on registration', () => {
    expect(commandInboundReadiness.isReady()).toBe(false);
    const listener = vi.fn();
    const off = commandInboundReadiness.onReady(listener);
    registerCommandInboundHandler(vi.fn(async () => {}));
    expect(commandInboundReadiness.isReady()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unregisterCommandInboundHandler();
    expect(commandInboundReadiness.isReady()).toBe(false);
    off();
    registerCommandInboundHandler(vi.fn(async () => {}));
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed listeners are not called
  });
});

describe('dispatchCommandInboundEvent', () => {
  it('rejects instead of resolving when no handler is registered', async () => {
    await expect(dispatchCommandInboundEvent(EVENT)).rejects.toThrow(/not registered/);
  });
  it('passes the event to the registered handler', async () => {
    const handler = vi.fn(async () => {});
    registerCommandInboundHandler(handler);
    await dispatchCommandInboundEvent(EVENT);
    expect(handler).toHaveBeenCalledWith(EVENT);
  });
});
