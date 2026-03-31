import { describe, it, expect, vi } from 'vitest';
import { createCallbackForwarder, noopForwarder } from '../forwarder.js';
import type { PlatformMessage } from '../types.js';

const sampleMessage: PlatformMessage = {
  id: 'msg-1',
  text: 'Hello',
  threadId: 'thread-1',
  author: { id: 'user-1', name: 'Alice' },
  timestamp: '2026-01-15T12:00:00.000Z',
  platform: 'telegram',
};

const sampleContext = { chatroomId: 'room-1', platform: 'telegram' };

describe('noopForwarder', () => {
  it('does not throw', async () => {
    await expect(noopForwarder.forward(sampleMessage, sampleContext)).resolves.toBeUndefined();
  });
});

describe('createCallbackForwarder', () => {
  it('calls the provided callback with message and context', async () => {
    const fn = vi.fn();
    const forwarder = createCallbackForwarder(fn);

    await forwarder.forward(sampleMessage, sampleContext);

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(sampleMessage, sampleContext);
  });

  it('supports async callbacks', async () => {
    const results: string[] = [];
    const fn = async (msg: PlatformMessage) => {
      results.push(msg.text);
    };
    const forwarder = createCallbackForwarder(fn);

    await forwarder.forward(sampleMessage, sampleContext);

    expect(results).toEqual(['Hello']);
  });
});
