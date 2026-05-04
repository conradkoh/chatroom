import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { OpencodeSdkSession } from './opencode-session.js';
import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/entities/direct-harness-session.js';

// ─── Mock @opencode-ai/sdk ───────────────────────────────────────────────────

const mockPrompt = vi.fn();
const mockAbort = vi.fn();
const mockSubscribe = vi.fn();

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(() => ({
    session: {
      prompt: mockPrompt,
      abort: mockAbort,
    },
    event: {
      subscribe: mockSubscribe,
    },
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createSession(overrides?: { baseUrl?: string }) {
  return new OpencodeSdkSession({
    baseUrl: overrides?.baseUrl ?? 'http://127.0.0.1:15432',
    harnessSessionId: 'sess-123',
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

  // ── onEvent() ───────────────────────────────────────────────────────────────

  it('subscribes to event stream on first onEvent call', () => {
    mockSubscribe.mockReturnValue({ stream: emptyStream() });

    const session = createSession();
    const unsub = session.onEvent(vi.fn());

    expect(mockSubscribe).toHaveBeenCalledOnce();
    unsub();
  });

  it('filters events by sessionID and forwards matching ones', async () => {
    const events = [
      { type: 'message.part.updated', properties: { sessionID: 'sess-other', delta: 'skip' } },
      { type: 'message.part.updated', properties: { sessionID: 'sess-123', delta: 'hello' } },
      { type: 'message.updated', properties: { sessionID: 'sess-123', info: { id: 'msg-1' } } },
      { type: 'session.status', properties: { sessionID: 'sess-other', status: 'idle' } },
    ];

    mockSubscribe.mockReturnValue({ stream: eventStream(events) });

    const session = createSession();
    const listener = vi.fn();
    session.onEvent(listener);

    // Yield to allow the event stream to process
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(2);
    });

    // Only sess-123 events were forwarded
    expect(listener).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'message.part.updated',
      payload: expect.objectContaining({ delta: 'hello' }),
    }));
    expect(listener).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'message.updated',
    }));
  });

  it('deduplicates multiple onEvent subscriptions (single event stream)', () => {
    mockSubscribe.mockReturnValue({ stream: emptyStream() });

    const session = createSession();
    session.onEvent(vi.fn());
    session.onEvent(vi.fn());

    expect(mockSubscribe).toHaveBeenCalledOnce();
  });

  it('unsubscribe removes the listener', async () => {
    const events = [
      { type: 'message.part.updated', properties: { sessionID: 'sess-123', delta: 'a' } },
      { type: 'message.part.updated', properties: { sessionID: 'sess-123', delta: 'b' } },
    ];

    mockSubscribe.mockReturnValue({ stream: eventStream(events) });

    const session = createSession();
    const listener = vi.fn();
    const unsub = session.onEvent(listener);

    // Unsubscribe before processing
    unsub();

    // Let the event stream run
    await vi.waitFor(() => {
      // The stream should have been consumed, but no events dispatched
      expect(listener).not.toHaveBeenCalled();
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
    mockSubscribe.mockReturnValue({ stream: emptyStream() });

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

  // ── properties ──────────────────────────────────────────────────────────────

  it('exposes harnessSessionId and sessionTitle', () => {
    const session = createSession();
    expect(session.harnessSessionId).toBe('sess-123');
    expect(session.sessionTitle).toBe('Test Session');
  });
});
