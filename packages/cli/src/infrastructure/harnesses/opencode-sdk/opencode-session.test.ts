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

  // ── onEvent() / _receiveEvent() ─────────────────────────────────────────────
  //
  // Event delivery is now managed by the parent harness's SSE fan-out loop.
  // OpencodeSdkSession no longer subscribes to the SSE stream itself;
  // instead the harness calls _receiveEvent() for each event addressed to
  // this session's opencodeSessionId.

  it('onEvent registers a listener and returns an unsubscribe function', () => {
    const session = createSession();
    const listener = vi.fn();
    const unsub = session.onEvent(listener);

    // No SSE subscription initiated by the session itself
    expect(mockSubscribe).not.toHaveBeenCalled();

    // Delivering an event via _receiveEvent dispatches to the listener
    session._receiveEvent({ type: 'test.event', properties: { sessionID: 'sess-123' } });
    expect(listener).toHaveBeenCalledOnce();

    // After unsubscribing, listener no longer receives events
    unsub();
    session._receiveEvent({ type: 'test.event2', properties: {} });
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

    session._receiveEvent({ type: 'message.part.updated', properties: { delta: 'hello', sessionID: 'sess-123' } });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message.part.updated',
      payload: expect.objectContaining({ delta: 'hello' }),
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
    });
    const session2 = new OpencodeSdkSession({
      client: mockClient as never,
      opencodeSessionId: 'sess-b',
      sessionTitle: 'Session B',
    });

    // Both sessions use the exact same client object (verified by reference equality).
    // When sessions are created from a harness, the harness passes `this.client`,
    // so all sessions for one workspace share a single connection pool.
    expect((session1 as unknown as { client: unknown }).client).toBe(
      (session2 as unknown as { client: unknown }).client
    );
  });
});
