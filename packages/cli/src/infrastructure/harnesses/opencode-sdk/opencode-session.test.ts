import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OpencodeSdkSession } from './opencode-session.js';
import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/entities/direct-harness-session.js';

// ─── Mock client ─────────────────────────────────────────────────────────────

const mockPromptAsync = vi.fn();
const mockAbort = vi.fn();

/** A reusable mock OpencodeClient — shared by tests to verify client sharing. */
const mockClient = {
  session: { promptAsync: mockPromptAsync, abort: mockAbort },
  event: {},
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createSession() {
  return new OpencodeSdkSession({
    client: mockClient as never,
    opencodeSessionId: 'sess-123',
    sessionTitle: 'Test Session',
    cwd: '/test/dir',
  });
}

/**
 * Deliver a session.idle event to a session via _receiveEvent after a short
 * delay. Used to unblock prompt() in tests that only care about promptAsync args.
 */
function deliverIdleAsync(session: OpencodeSdkSession, delayMs = 5): void {
  setTimeout(() => {
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
  }, delayMs);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpencodeSdkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── prompt() ────────────────────────────────────────────────────────────────

  it('calls session.promptAsync with the correct args', async () => {
    mockPromptAsync.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {}); // start consumer
    deliverIdleAsync(session);

    await session.prompt({
      agent: 'builder',
      parts: [{ type: 'text', text: 'hello' }],
    });

    expect(mockPromptAsync).toHaveBeenCalledWith({
      path: { id: 'sess-123' },
      body: {
        agent: 'builder',
        parts: [{ type: 'text', text: 'hello' }],
      },
    });
  });

  it('passes optional model, system, tools to session.promptAsync', async () => {
    mockPromptAsync.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {}); // start consumer
    deliverIdleAsync(session);

    await session.prompt({
      agent: 'planner',
      parts: [{ type: 'text', text: 'design' }],
      model: { providerID: 'openai', modelID: 'gpt-4' },
      system: 'Be creative',
      tools: { task: false },
    });

    expect(mockPromptAsync).toHaveBeenCalledWith({
      path: { id: 'sess-123' },
      body: {
        agent: 'planner',
        parts: [{ type: 'text', text: 'design' }],
        model: { providerID: 'openai', modelID: 'gpt-4' },
        system: 'Be creative',
        tools: { task: false },
      },
    });
  });

  it('throws when prompting a closed session', async () => {
    const session = createSession();
    await session.close();
    await expect(session.prompt({
      agent: 'builder',
      parts: [{ type: 'text', text: 'nope' }],
    })).rejects.toThrow('Session is closed');
  });

  it('prompt() resolves when session.idle arrives via _receiveEvent (harness fan-out)', async () => {
    mockPromptAsync.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    // Start prompt (waits for session.idle)
    const promptDone = session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    // Allow promptAsync to be submitted
    await new Promise<void>((r) => setTimeout(r, 5));

    // Deliver content then idle via harness fan-out
    session._receiveEvent({ type: 'message.part.updated', properties: { sessionID: 'sess-123', delta: 'hello' } as never });
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });

    await promptDone;
    // Let consumer drain
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(events.some((e) => e.type === 'message.part.updated')).toBe(true);
    expect(events.some((e) => e.type === 'session.idle')).toBe(true);
  });

  it('prompt() emits session.idle manually as fallback when SSE times out', async () => {
    vi.useFakeTimers();
    mockPromptAsync.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    const promptDone = session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });
    await vi.advanceTimersByTimeAsync(300_001);
    await promptDone;

    expect(events.some((e) => e.type === 'session.idle')).toBe(true);
    vi.useRealTimers();
  });

  // ── onEvent() / _receiveEvent() ─────────────────────────────────────────────
  //
  // Event delivery: harness SSE fan-out pushes events via _receiveEvent() into the
  // session buffer; the async consumer loop drains the buffer and dispatches to listeners.

  it('onEvent registers a listener and returns an unsubscribe function', async () => {
    const session = createSession();
    const listener = vi.fn();
    const unsub = session.onEvent(listener);

    // Delivering an event via _receiveEvent pushes to buffer; consumer delivers async
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
    // Let the consumer process the buffered event
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(listener).toHaveBeenCalledOnce();

    // After unsubscribing, listener no longer receives events
    unsub();
    session._receiveEvent({ type: 'server.connected', properties: {} });
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(listener).toHaveBeenCalledOnce(); // still 1
  });

  it('_receiveEvent dispatches to all registered listeners', async () => {
    const session = createSession();
    const a = vi.fn();
    const b = vi.fn();
    session.onEvent(a);
    session.onEvent(b);

    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.idle' }));
  });

  it('_receiveEvent maps properties to payload on the emitted event', async () => {
    const session = createSession();
    const listener = vi.fn();
    session.onEvent(listener);

    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session.idle',
      payload: expect.objectContaining({ sessionID: 'sess-123' }),
    }));
  });

  // ── close() ─────────────────────────────────────────────────────────────────

  it('calls session.abort on close', async () => {
    mockAbort.mockResolvedValue({});

    const session = createSession();
    await session.close();

    expect(mockAbort).toHaveBeenCalledWith({
      path: { id: 'sess-123' },
    });
  });

  it('is idempotent — second close is a no-op', async () => {
    mockAbort.mockResolvedValue({});

    const session = createSession();
    await session.close();
    await session.close();

    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it('handles 404 from session.abort gracefully', async () => {
    mockAbort.mockRejectedValue({ status: 404 });

    const session = createSession();
    // Should not throw
    await expect(session.close()).resolves.toBeUndefined();
  });

  it('re-throws non-404 errors from session.abort', async () => {
    mockAbort.mockRejectedValue(new Error('network error'));

    const session = createSession();
    await expect(session.close()).rejects.toThrow('network error');
  });

  // ── _emit() ─────────────────────────────────────────────────────────────────

  it('_emit dispatches events to all subscribers', () => {
    const session = createSession();
    const a = vi.fn();
    const b = vi.fn();
    session.onEvent(a);
    session.onEvent(b);

    const event: DirectHarnessSessionEvent = {
      type: 'test.event',
      payload: { key: 'value' },
      timestamp: 100,
    };
    session._emit(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('_emit does not dispatch after close', async () => {
    mockAbort.mockResolvedValue({});

    const session = createSession();
    const listener = vi.fn();
    session.onEvent(listener);
    await session.close();

    session._emit({ type: 'after.close', payload: {}, timestamp: 200 });
    expect(listener).not.toHaveBeenCalled();
  });

  // ── setTitle() ──────────────────────────────────────────────────────────────

  it('setTitle updates sessionTitle', () => {
    const session = createSession();
    expect(session.sessionTitle).toBe('Test Session');
    session.setTitle?.('New Title');
    expect(session.sessionTitle).toBe('New Title');
  });

  // ── session.updated event handler contract ──────────────────────────────────
  //
  // session-subscriber.ts handles 'session.updated' events to sync the
  // auto-generated OpenCode title back to Convex. These tests verify the
  // primitives that handler relies on.

  it('session.updated: _emit forwards event to listener and setTitle is callable', () => {
    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    const updatedEvent: DirectHarnessSessionEvent = {
      type: 'session.updated',
      payload: { info: { id: 'sess-123', title: 'Debug the auth issue', version: '1' } },
      timestamp: Date.now(),
    };
    session._emit(updatedEvent);

    // Event must reach listener so session-subscriber can inspect it
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('session.updated');

    // Subscriber calls setTitle when the new title differs from the current one
    const newTitle = (updatedEvent.payload as { info?: { title?: string } }).info?.title;
    if (newTitle && newTitle !== session.sessionTitle) {
      session.setTitle(newTitle);
    }
    expect(session.sessionTitle).toBe('Debug the auth issue');
  });

  it('session.updated: setTitle is NOT called when title is same as current', () => {
    const session = createSession(); // sessionTitle = 'Test Session'
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    const updatedEvent: DirectHarnessSessionEvent = {
      type: 'session.updated',
      payload: { info: { id: 'sess-123', title: 'Test Session', version: '1' } },
      timestamp: Date.now(),
    };
    session._emit(updatedEvent);

    // Guard: same title → no setTitle call
    const newTitle = (updatedEvent.payload as { info?: { title?: string } }).info?.title;
    const before = session.sessionTitle;
    if (newTitle && newTitle !== session.sessionTitle) {
      session.setTitle(newTitle);
    }
    expect(session.sessionTitle).toBe(before); // unchanged
  });

  it('session.updated: setTitle is NOT called when info.title is absent', () => {
    const session = createSession();
    const before = session.sessionTitle;

    const updatedEvent: DirectHarnessSessionEvent = {
      type: 'session.updated',
      payload: { info: { id: 'sess-123' } }, // no title field
      timestamp: Date.now(),
    };
    session._emit(updatedEvent);

    const newTitle = (updatedEvent.payload as { info?: { title?: string } }).info?.title;
    if (newTitle && newTitle !== session.sessionTitle) {
      session.setTitle(newTitle);
    }
    expect(session.sessionTitle).toBe(before); // unchanged
  });

  it('SSE events arrive before session.idle — all delivered to listeners', async () => {
    mockPromptAsync.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    const promptDone = session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    // Allow promptAsync to submit
    await new Promise<void>((r) => setTimeout(r, 5));

    // Deliver content then idle via harness fan-out
    session._receiveEvent({ type: 'message.part.updated', properties: { sessionID: 'sess-123', delta: 'chunk1' } as never });
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });

    await promptDone;
    // Let consumer drain
    await new Promise<void>((r) => setTimeout(r, 20));

    // Content event and idle both delivered
    expect(events.some((e) => e.type === 'message.part.updated')).toBe(true);
    expect(events.some((e) => e.type === 'session.idle')).toBe(true);
  });

  // ── properties ──────────────────────────────────────────────────────────────

  it('exposes opencodeSessionId and sessionTitle', () => {
    const session = createSession();
    expect(session.opencodeSessionId).toBe('sess-123');
    expect(session.sessionTitle).toBe('Test Session');
  });

  // ── Buffer consumer ────────────────────────────────────────────────────────

  it('buffer consumer: _receiveEvent pushes into buffer; with a listener, event is delivered in order', async () => {
    const session = createSession();
    const received: DirectHarnessSessionEvent[] = [];

    // Register listener — starts the consumer
    session.onEvent((e) => received.push(e));

    // Push three events via _receiveEvent
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });

    // Let the consumer drain
    await new Promise<void>((r) => setTimeout(r, 20));

    // Delivered in FIFO order — 3 events received
    expect(received).toHaveLength(3);
    expect(received.every((e) => e.type === 'session.idle')).toBe(true);
  });

  it('buffer consumer: events pushed before listener registers are delivered when first onEvent registers', async () => {
    const session = createSession();

    // Push events BEFORE any listener registers
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });

    const received: DirectHarnessSessionEvent[] = [];

    // Registering the first listener starts the consumer, which drains buffered events
    session.onEvent((e) => received.push(e));

    // Let the consumer drain the pre-buffered events
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(received).toHaveLength(2);
    expect(received[0]?.type).toBe('session.idle');
    expect(received[1]?.type).toBe('session.idle');
  });

  it('buffer consumer: pushing session.idle resolves an in-flight prompt()', async () => {
    mockPromptAsync.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    // Start prompt (it waits for session.idle)
    const promptDone = session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    // Allow promptAsync + consumer to start
    await new Promise<void>((r) => setTimeout(r, 10));

    // Deliver session.idle via _receiveEvent (simulating harness fan-out)
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });

    // prompt() should resolve now
    await promptDone;

    // Consumer should have delivered the idle event to listeners too
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(events.some((e) => e.type === 'session.idle')).toBe(true);
  });

  it('buffer consumer: close() drains pending buffered events to listeners before shutting down', async () => {
    mockAbort.mockResolvedValue({});

    const session = createSession();
    const received: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => received.push(e));

    // Push events that haven't been processed yet
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });

    // close() must drain these events before clearing listeners
    await session.close();

    // Both events should have been delivered before close completed
    expect(received).toHaveLength(2);
    expect(received.every((e) => e.type === 'session.idle')).toBe(true);
  });

  it('two sessions created with the same client share the same client reference', () => {
    const session1 = new OpencodeSdkSession({
      client: mockClient as never,
      opencodeSessionId: 'sess-a',
      sessionTitle: 'Session A',
      cwd: '/test/dir',
    });
    const session2 = new OpencodeSdkSession({
      client: mockClient as never,
      opencodeSessionId: 'sess-b',
      sessionTitle: 'Session B',
      cwd: '/test/dir',
    });

    // Both sessions use the exact same client object (verified by reference equality).
    expect((session1 as unknown as { client: unknown }).client).toBe(
      (session2 as unknown as { client: unknown }).client
    );
  });
});
