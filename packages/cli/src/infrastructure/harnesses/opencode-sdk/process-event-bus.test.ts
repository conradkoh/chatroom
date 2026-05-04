import { describe, it, expect, vi } from 'vitest';

import { ProcessEventBus, extractEventSessionId } from './process-event-bus.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock client whose event stream yields the given events then ends. */
function makeClient(events: Array<{ type: string; properties?: Record<string, unknown> }>) {
  return {
    event: {
      subscribe: vi.fn().mockResolvedValue({
        stream: (async function* () {
          for (const e of events) yield e;
        })(),
      }),
    },
  };
}

// ─── extractEventSessionId ───────────────────────────────────────────────────

describe('extractEventSessionId', () => {
  it('returns sessionID from top-level properties', () => {
    expect(extractEventSessionId({ properties: { sessionID: 'sess-A' } })).toBe('sess-A');
  });

  it('returns sessionID from part.sessionID (message.part.updated)', () => {
    expect(
      extractEventSessionId({ properties: { part: { sessionID: 'sess-B', type: 'text' } } })
    ).toBe('sess-B');
  });

  it('returns id from info.id (session.created / session.updated / session.deleted)', () => {
    expect(
      extractEventSessionId({ properties: { info: { id: 'sess-C', title: 'My session' } } })
    ).toBe('sess-C');
  });

  it('falls back to info.sessionID when info.id is absent', () => {
    expect(
      extractEventSessionId({ properties: { info: { sessionID: 'sess-D' } } })
    ).toBe('sess-D');
  });

  it('returns undefined for workspace-level events with no session identifier', () => {
    expect(extractEventSessionId({ properties: { file: 'src/foo.ts' } })).toBeUndefined();
    expect(extractEventSessionId({ properties: {} })).toBeUndefined();
    expect(extractEventSessionId({ properties: undefined })).toBeUndefined();
    expect(extractEventSessionId({})).toBeUndefined();
  });
});

// ─── ProcessEventBus ──────────────────────────────────────────────────────────

describe('ProcessEventBus', () => {
  it('routes a session-scoped event to the matching registered handler', async () => {
    const received: string[] = [];
    const client = makeClient([{ type: 'session.idle', properties: { sessionID: 'sess-A' } }]);

    const bus = new ProcessEventBus(client, () => 0);
    bus.register('sess-A', (type) => received.push(type));

    await new Promise((r) => setTimeout(r, 20));

    expect(received).toEqual(['session.idle']);
  });

  it('does NOT route an event to a handler registered for a different session', async () => {
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const client = makeClient([{ type: 'session.idle', properties: { sessionID: 'sess-A' } }]);

    const bus = new ProcessEventBus(client, () => 0);
    bus.register('sess-A', (type) => receivedA.push(type));
    bus.register('sess-B', (type) => receivedB.push(type));

    await new Promise((r) => setTimeout(r, 20));

    expect(receivedA).toEqual(['session.idle']); // correct session
    expect(receivedB).toEqual([]);               // other session — must be empty
  });

  it('broadcasts workspace-level events (no sessionID) to all registered handlers', async () => {
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const client = makeClient([{ type: 'file.edited', properties: { file: 'src/foo.ts' } }]);

    const bus = new ProcessEventBus(client, () => 0);
    bus.register('sess-A', (type) => receivedA.push(type));
    bus.register('sess-B', (type) => receivedB.push(type));

    await new Promise((r) => setTimeout(r, 20));

    expect(receivedA).toEqual(['file.edited']);
    expect(receivedB).toEqual(['file.edited']);
  });

  it('routes message.part.updated via part.sessionID', async () => {
    const received: Array<{ type: string; props: unknown }> = [];
    const client = makeClient([
      {
        type: 'message.part.updated',
        properties: {
          part: { sessionID: 'sess-A', type: 'text', id: 'p1', messageID: 'm1', text: 'hello' },
          delta: 'hello',
        },
      },
    ]);

    const bus = new ProcessEventBus(client, () => 0);
    bus.register('sess-A', (type, props) => received.push({ type, props }));

    await new Promise((r) => setTimeout(r, 20));

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('message.part.updated');
  });

  it('does not route message.part.updated from a different session', async () => {
    const received: string[] = [];
    const client = makeClient([
      {
        type: 'message.part.updated',
        properties: {
          part: { sessionID: 'sess-B', type: 'text', id: 'p1', messageID: 'm1', text: 'hi' },
        },
      },
    ]);

    const bus = new ProcessEventBus(client, () => 0);
    bus.register('sess-A', (type) => received.push(type));

    await new Promise((r) => setTimeout(r, 20));

    expect(received).toHaveLength(0);
  });

  it('stops routing events after stop() is called', async () => {
    const received: string[] = [];

    let yieldSecond!: () => void;
    const client = {
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: (async function* () {
            yield { type: 'session.idle', properties: { sessionID: 'sess-A' } };
            await new Promise<void>((r) => { yieldSecond = r; });
            yield { type: 'session.status', properties: { sessionID: 'sess-A', status: { type: 'idle' } } };
          })(),
        }),
      },
    };

    const bus = new ProcessEventBus(client, () => 0);
    bus.register('sess-A', (type) => received.push(type));

    await new Promise((r) => setTimeout(r, 20)); // let first event arrive
    bus.stop();
    yieldSecond();
    await new Promise((r) => setTimeout(r, 20)); // second event should not arrive

    expect(received).toEqual(['session.idle']);
  });

  it('unregister() removes the handler — subsequent events are not delivered', async () => {
    const received: string[] = [];

    let yieldSecond!: () => void;
    const client = {
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: (async function* () {
            yield { type: 'session.idle', properties: { sessionID: 'sess-A' } };
            await new Promise<void>((r) => { yieldSecond = r; });
            yield { type: 'session.status', properties: { sessionID: 'sess-A', status: { type: 'idle' } } };
          })(),
        }),
      },
    };

    const bus = new ProcessEventBus(client, () => 0);
    const unregister = bus.register('sess-A', (type) => received.push(type));

    await new Promise((r) => setTimeout(r, 20));
    unregister(); // deregister before second event
    yieldSecond();
    await new Promise((r) => setTimeout(r, 20));

    expect(received).toEqual(['session.idle']); // only first event
  });

  it('handles multiple sessions concurrently with correct per-session routing', async () => {
    const receivedA: string[] = [];
    const receivedB: string[] = [];

    const client = makeClient([
      { type: 'session.idle', properties: { sessionID: 'sess-A' } },
      { type: 'session.idle', properties: { sessionID: 'sess-B' } },
      { type: 'message.part.updated', properties: { part: { sessionID: 'sess-A', type: 'text', id: 'p', messageID: 'm', text: 'hi' } } },
    ]);

    const bus = new ProcessEventBus(client, () => 0);
    bus.register('sess-A', (type) => receivedA.push(type));
    bus.register('sess-B', (type) => receivedB.push(type));

    await new Promise((r) => setTimeout(r, 20));

    expect(receivedA).toEqual(['session.idle', 'message.part.updated']);
    expect(receivedB).toEqual(['session.idle']);
  });

  it('opens exactly one SSE connection regardless of how many sessions are registered', async () => {
    const client = makeClient([]);
    const bus = new ProcessEventBus(client, () => 0);

    bus.register('sess-A', () => {});
    bus.register('sess-B', () => {});
    bus.register('sess-C', () => {});

    await new Promise((r) => setTimeout(r, 20));

    // subscribe() must have been called exactly once
    expect(client.event.subscribe).toHaveBeenCalledTimes(1);
  });
});
