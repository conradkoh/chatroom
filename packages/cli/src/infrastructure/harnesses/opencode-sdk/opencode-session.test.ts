import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { OpencodeSdkSession } from './opencode-session.js';
import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/entities/direct-harness-session.js';

// ─── Mock client ─────────────────────────────────────────────────────────────

const mockPrompt = vi.fn();
const mockAbort = vi.fn();
const mockSubscribe = vi.fn();

/** A reusable mock OpencodeClient — shared by tests to verify client sharing. */
const mockClient = {
  session: { prompt: mockPrompt, abort: mockAbort },
  event: { subscribe: mockSubscribe },
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

function emptyStream(): AsyncGenerator<unknown> {
  // An async generator that yields no events and completes immediately
  return {
    next: async () => ({ done: true as const, value: undefined }),
    return: async () => ({ done: true as const, value: undefined }),
    throw: async () => ({ done: true as const, value: undefined }),
    [Symbol.asyncIterator]() { return this; },
  };
}

function eventStream(events: unknown[]): AsyncGenerator<unknown> {
  const iter = events[Symbol.iterator]();
  return {
    next: async () => {
      const next = iter.next();
      if (next.done) return { done: true as const, value: undefined };
      return { done: false as const, value: next.value };
    },
    return: async () => ({ done: true as const, value: undefined }),
    throw: async () => ({ done: true as const, value: undefined }),
    [Symbol.asyncIterator]() { return this; },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpencodeSdkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── prompt() ────────────────────────────────────────────────────────────────

  it('calls session.prompt with the correct args', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    await session.prompt({
      agent: 'builder',
      parts: [{ type: 'text', text: 'hello' }],
    });

    expect(mockPrompt).toHaveBeenCalledWith({
      path: { id: 'sess-123' },
      body: {
        agent: 'builder',
        parts: [{ type: 'text', text: 'hello' }],
      },
    });
  });

  it('passes optional model, system, tools to session.prompt', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    await session.prompt({
      agent: 'planner',
      parts: [{ type: 'text', text: 'design' }],
      model: { providerID: 'openai', modelID: 'gpt-4' },
      system: 'Be creative',
      tools: { task: false },
    });

    expect(mockPrompt).toHaveBeenCalledWith({
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

  it('emits message.part.updated events for text and reasoning parts in the HTTP response', async () => {
    mockPrompt.mockResolvedValue({
      data: {
        parts: [
          { id: 'p1', messageID: 'msg-1', type: 'text', text: 'Hello world' },
          { id: 'p2', messageID: 'msg-1', type: 'reasoning', text: 'Thinking...' },
        ],
      },
    });

    const session = createSession();
    const events: import('../../../domain/direct-harness/entities/direct-harness-session.js').DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    await session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    // Should emit message.part.updated for each text/reasoning part, then session.idle
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: 'message.part.updated',
      payload: { part: { id: 'p1', messageID: 'msg-1', type: 'text' }, delta: 'Hello world' },
    });
    expect(events[1]).toMatchObject({
      type: 'message.part.updated',
      payload: { part: { id: 'p2', messageID: 'msg-1', type: 'reasoning' }, delta: 'Thinking...' },
    });
    expect(events[2]).toMatchObject({ type: 'session.idle' });
  });

  it('emits session.idle even when there are no parts in the HTTP response', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    const events: import('../../../domain/direct-harness/entities/direct-harness-session.js').DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    await session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'session.idle' });
  });

  it('skips parts with empty text or non-text type', async () => {
    // SDK Part type guarantees id, messageID are always present.
    // We only skip parts with empty/missing text or non-text type.
    mockPrompt.mockResolvedValue({
      data: {
        parts: [
          { id: 'p1', messageID: 'msg-1', type: 'text', text: '' },         // empty text
          { id: 'p2', messageID: 'msg-1', type: 'text' },                    // no text field
          { id: 'p5', messageID: 'msg-1', type: 'image', text: 'img.png' }, // non-text type
        ],
      },
    });

    const session = createSession();
    const events: import('../../../domain/direct-harness/entities/direct-harness-session.js').DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    await session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    // Only session.idle should be emitted (no valid parts)
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'session.idle' });
  });

  // ── onEvent() / _receiveEvent() ─────────────────────────────────────────────
  //
  // Event delivery: per-session SSE starts lazily on first onEvent() call.
  // The parent harness SSE fan-out loop also delivers events via _receiveEvent().

  it('onEvent registers a listener and returns an unsubscribe function', () => {
    const session = createSession();
    const listener = vi.fn();
    const unsub = session.onEvent(listener);

    // Per-session SSE is now started on first onEvent() call
    expect(mockSubscribe).toHaveBeenCalled();

    // Delivering an event via _receiveEvent dispatches to the listener
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });
    expect(listener).toHaveBeenCalledOnce();

    // After unsubscribing, listener no longer receives events
    unsub();
    session._receiveEvent({ type: 'server.connected', properties: {} });
    expect(listener).toHaveBeenCalledOnce(); // still 1
  });

  it('_receiveEvent dispatches to all registered listeners', () => {
    const session = createSession();
    const a = vi.fn();
    const b = vi.fn();
    session.onEvent(a);
    session.onEvent(b);

    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.idle' }));
  });

  it('_receiveEvent maps properties to payload on the emitted event', () => {
    const session = createSession();
    const listener = vi.fn();
    session.onEvent(listener);

    // Use a valid SDK event — session.idle has { sessionID: string } properties
    session._receiveEvent({ type: 'session.idle', properties: { sessionID: 'sess-123' } });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session.idle',
      payload: expect.objectContaining({ sessionID: 'sess-123' }),
    }));
  });

  it('per-session SSE: only delivers events for this session ID, ignoring others', async () => {
    // Setup: simulate SSE stream with events for two different sessions
    mockSubscribe.mockResolvedValue({
      stream: (async function* () {
        // Event for a different session — should NOT be dispatched
        yield { type: 'message.part.updated', properties: { sessionID: 'other-session', delta: 'ignore' } };
        // Event for this session — SHOULD be dispatched
        yield { type: 'message.part.updated', properties: { sessionID: 'sess-123', delta: 'hello' } };
      })(),
    });

    const session = createSession();
    const received: unknown[] = [];
    session.onEvent((e) => received.push(e));

    // Give the SSE stream time to process
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Subscribe must have been called with the directory parameter
    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ query: { directory: '/test/dir' } })
    );

    // Only the event for 'sess-123' should have been dispatched
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'message.part.updated',
      payload: expect.objectContaining({ delta: 'hello' }),
    });
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

  it('when SSE delivers events during prompt(), HTTP response parts are NOT emitted', async () => {
    // Simulate SSE delivering an event for this session
    mockSubscribe.mockResolvedValue({
      stream: (async function* () {
        // Small delay to ensure this arrives DURING the prompt() HTTP call
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield { type: 'message.part.updated', properties: { sessionID: 'sess-123', delta: 'from-sse' } };
      })(),
    });

    // HTTP response also has parts (which should NOT be emitted when SSE delivered).
    // Delay the HTTP response so SSE has time to deliver its event first.
    mockPrompt.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ data: { parts: [{ id: 'p1', messageID: 'msg-1', type: 'text', text: 'from-http' }] } }),
            50
          )
        )
    );

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    // Call prompt() — SSE will deliver its event during the delayed HTTP call
    await session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    // Should NOT have the 'from-http' part (SSE delivered, so HTTP emission was skipped)
    const textEvents = events.filter((e) => e.type === 'message.part.updated');
    const httpEvent = textEvents.find((e) => (e.payload as { delta?: string }).delta === 'from-http');
    expect(httpEvent).toBeUndefined();
    // session.idle must always be emitted
    const idleEvents = events.filter((e) => e.type === 'session.idle');
    expect(idleEvents).toHaveLength(1);
  });

  it('when SSE does NOT deliver events during prompt(), HTTP response parts ARE emitted as fallback', async () => {
    // SSE stream produces no events for this session
    mockSubscribe.mockResolvedValue({ stream: emptyStream() });

    // HTTP response has parts
    mockPrompt.mockResolvedValue({
      data: {
        parts: [
          { id: 'p1', messageID: 'msg-1', type: 'text', text: 'from-http' },
        ],
      },
    });

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    await session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    // Should have: HTTP part emitted + session.idle
    const httpEvents = events.filter(
      (e) => e.type === 'message.part.updated' && (e.payload as { delta?: string }).delta === 'from-http'
    );
    expect(httpEvents).toHaveLength(1);
    // session.idle must always be emitted
    const idleEvents = events.filter((e) => e.type === 'session.idle');
    expect(idleEvents).toHaveLength(1);
  });

  it('session.idle is always emitted regardless of SSE delivery', async () => {
    mockSubscribe.mockResolvedValue({ stream: emptyStream() });
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    await session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });

    const idleEvents = events.filter((e) => e.type === 'session.idle');
    expect(idleEvents).toHaveLength(1);
  });

  // ── sseDeliveredForCurrentPrompt flag ─────────────────────────────────────

  it('sseDeliveredForCurrentPrompt is false initially', () => {
    const session = createSession();
    expect(session.sseDeliveredForCurrentPrompt).toBe(false);
  });

  it('sseDeliveredForCurrentPrompt is set to true when SSE events arrive during generation', async () => {
    // Simulate an SSE stream that delivers one event for this session
    mockSubscribe.mockResolvedValue({
      stream: (async function* () {
        yield { type: 'message.part.updated', properties: { sessionID: 'sess-123', delta: 'hi' } };
      })(),
    });

    mockPrompt.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {}); // register listener to start SSE stream

    // Give the SSE stream time to receive and process the event
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(session.sseDeliveredForCurrentPrompt).toBe(true);
  });

  it('sseDeliveredForCurrentPrompt resets to false at the start of prompt()', async () => {
    // First, make the flag true by simulating SSE delivery
    mockSubscribe.mockResolvedValue({ stream: emptyStream() });
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    // Manually set the flag via internal access to simulate prior SSE delivery
    (session as unknown as { _sseDeliveredForCurrentPrompt: boolean })._sseDeliveredForCurrentPrompt = true;
    expect(session.sseDeliveredForCurrentPrompt).toBe(true);

    // Calling prompt() should reset it before making the HTTP call
    await session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'test' }] });

    // After prompt() completes, the flag reflects what happened DURING this prompt,
    // which is false because the mock SSE stream is empty
    expect(session.sseDeliveredForCurrentPrompt).toBe(false);
  });

  // ── properties ──────────────────────────────────────────────────────────────

  it('exposes opencodeSessionId and sessionTitle', () => {
    const session = createSession();
    expect(session.opencodeSessionId).toBe('sess-123');
    expect(session.sessionTitle).toBe('Test Session');
  });

  it('two sessions created with the same client share the same client reference', () => {
    // Both sessions receive the same mockClient — they share one HTTP client.
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
    // When sessions are created from a harness, the harness passes `this.client`,
    // so all sessions for one workspace share a single connection pool.
    expect((session1 as unknown as { client: unknown }).client).toBe(
      (session2 as unknown as { client: unknown }).client
    );
  });
});
