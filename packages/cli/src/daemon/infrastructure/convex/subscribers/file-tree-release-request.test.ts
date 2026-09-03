import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startFileTreeReleaseRequestSubscriber } from './file-tree-release-request.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';

const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';

function createMockWsClient() {
  const callbacks: ((result: unknown) => void)[] = [];
  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      callbacks.push(onUpdate);
      return vi.fn();
    }),
    query: vi.fn().mockResolvedValue([]),
  } as unknown as ConvexClient;

  return {
    wsClient,
    emitHead: (result: unknown) => callbacks.forEach((callback) => callback(result)),
  };
}

function startSubscriber(
  wsClient: ConvexClient,
  events: InboundEvent[]
): ReturnType<typeof startFileTreeReleaseRequestSubscriber> {
  return startFileTreeReleaseRequestSubscriber(
    { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
    (event) => events.push(event)
  );
}

describe('file-tree release subscriber', () => {
  it('emits once for a revision and again when the revision changes', async () => {
    const events: InboundEvent[] = [];
    const mock = createMockWsClient();
    const handle = startSubscriber(mock.wsClient, events);

    mock.emitHead({ revision: 1 });
    mock.emitHead({ revision: 1 });
    mock.emitHead({ revision: 2 });
    await handle.stop();

    expect(events).toEqual([
      { type: 'file-tree.release', requestId: 'rev-1' },
      { type: 'file-tree.release', requestId: 'rev-2' },
    ]);
  });

  it('emits a startup event when pending rows exist', async () => {
    const events: InboundEvent[] = [];
    const mock = createMockWsClient();
    vi.mocked(mock.wsClient.query).mockResolvedValue([
      { workingDir: '/workspace', updatedAt: 1 },
    ] as never);
    const handle = startSubscriber(mock.wsClient, events);

    await vi.waitFor(() =>
      expect(events).toContainEqual({ type: 'file-tree.release', requestId: 'startup' })
    );
    await handle.stop();
  });

  it('resets the revision after the head disappears', async () => {
    const events: InboundEvent[] = [];
    const mock = createMockWsClient();
    const handle = startSubscriber(mock.wsClient, events);

    mock.emitHead({ revision: 1 });
    mock.emitHead(null);
    mock.emitHead({ revision: 1 });
    await handle.stop();

    expect(events).toHaveLength(2);
  });
});
