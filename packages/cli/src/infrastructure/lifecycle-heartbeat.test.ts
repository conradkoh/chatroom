import { describe, expect, it, vi } from 'vitest';

import { sendLifecycleHeartbeat } from './lifecycle-heartbeat.js';

describe('sendLifecycleHeartbeat', () => {
  it('calls participants.join for team agent role', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const client = { mutation };

    sendLifecycleHeartbeat(client, {
      sessionId: 's',
      chatroomId: 'c',
      role: 'planner',
      action: 'some-action',
    });

    await vi.waitFor(() => {
      expect(mutation).toHaveBeenCalledTimes(1);
    });
    const args = mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(args.sessionId).toBe('s');
    expect(args.chatroomId).toBe('c');
    expect(args.role).toBe('planner');
    expect(args.action).toBe('some-action');
  });

  it('calls participants.join for ephemeral enhancer team role', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const client = { mutation };

    sendLifecycleHeartbeat(client, {
      sessionId: 's',
      chatroomId: 'c',
      role: 'enhancer',
    });

    await vi.waitFor(() => {
      expect(mutation).toHaveBeenCalledTimes(1);
    });
    const args = mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(args.role).toBe('enhancer');
  });

  it('omits action arg when not provided', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const client = { mutation };

    sendLifecycleHeartbeat(client, {
      sessionId: 's',
      chatroomId: 'c',
      role: 'builder',
    });

    await vi.waitFor(() => {
      expect(mutation).toHaveBeenCalledTimes(1);
    });
    const args = mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(args.action).toBeUndefined();
  });
});
