import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  commandInboundReadiness,
  registerCommandInboundHandler,
  unregisterCommandInboundHandler,
} from './command-inbound-registry.js';

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
