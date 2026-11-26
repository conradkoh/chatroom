import type { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { unregisterCommandInboundHandler } from './command-inbound-registry.js';
import { startAllSubscribers, type SubscriberRegistryDeps } from './subscriber-registry.js';
import { api } from '../../api.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

type WatchCallback = (value: unknown) => void;

/**
 * Convex port fake. Captures the watch callback for getPendingFileTreeRequests so the
 * test can push a pending request into the real subscriber; every mutation/query returns null.
 */
function createWsClient() {
  let fileTreeWatch: WatchCallback | undefined;
  const wsClient = {
    onUpdate: vi.fn((ref: unknown, _args: unknown, callback: WatchCallback) => {
      if (
        getFunctionName(ref as never) ===
        getFunctionName(api.workspaceFiles.getPendingFileTreeRequests)
      ) {
        fileTreeWatch = callback;
      }
      return vi.fn();
    }),
    mutation: vi.fn(async () => null),
    query: vi.fn(async () => null),
  } as unknown as ConvexClient;
  return {
    wsClient,
    pushPendingFileTreeRequest: (value: unknown) => fileTreeWatch?.(value),
  };
}

afterEach(() => {
  unregisterCommandInboundHandler();
  vi.restoreAllMocks();
});

describe('startAllSubscribers: router rejections', () => {
  it('logs a rejected router event once and does not raise an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const { wsClient, pushPendingFileTreeRequest } = createWsClient();
    const deliverInbound = vi.fn(async () => {
      throw new Error('router boom');
    });
    const deps = {
      wsClient,
      sessionId: 'session-test' as SessionId,
      machineId: 'machine-test',
      router: {
        command: {},
        workspaceGit: {},
        agenticQuery: {},
        file: { deliverInbound },
      },
    } as unknown as SubscriberRegistryDeps;

    try {
      const registry = startAllSubscribers(deps);
      pushPendingFileTreeRequest([
        { _id: 'req-1', workingDir: '/workspace/a', force: false, updatedAt: 1 },
      ]);
      await tick();

      expect(deliverInbound).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'file-tree.request', requestId: 'req-1' })
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[daemon\] inbound event file-tree\.request failed: .*router boom/)
      );
      expect(unhandled).not.toHaveBeenCalled();
      await registry.stopAll();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
