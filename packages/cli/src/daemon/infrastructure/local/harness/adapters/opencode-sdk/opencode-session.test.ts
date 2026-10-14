import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OpencodeSdkSession } from './opencode-session.js';
import type { DirectHarnessSessionEvent } from '../../../../../domain/entities/direct-harness-session.js';

// ─── Mock client ─────────────────────────────────────────────────────────────

const mockPrompt = vi.fn();
const mockInterrupt = vi.fn();
const mockSwitchAgent = vi.fn();
const mockSwitchModel = vi.fn();
const mockInstructionPut = vi.fn();

/** A reusable mock OpenCode client — shared by tests to verify client sharing. */
const mockClient = {
  session: {
    prompt: mockPrompt,
    interrupt: mockInterrupt,
    switchAgent: mockSwitchAgent,
    switchModel: mockSwitchModel,
    instructions: { entry: { put: mockInstructionPut } },
  },
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

function idleEvent() {
  return { type: 'session.idle', data: { sessionID: 'sess-123' } };
}

/** OpenCode V2 turn-terminal event (what prompt() actually waits for). */
function turnDoneEvent() {
  return { type: 'session.execution.succeeded', data: { sessionID: 'sess-123' } };
}

/**
 * Deliver a turn-terminal event to a session via _receiveEvent after a short
 * delay. Used to unblock prompt() in tests that only care about prompt args.
 */
function deliverIdleAsync(session: OpencodeSdkSession, delayMs = 5): void {
  setTimeout(() => {
    session._receiveEvent(turnDoneEvent() as never);
  }, delayMs);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpencodeSdkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── prompt() ────────────────────────────────────────────────────────────────

  it('switches agent and calls session.prompt with the correct args', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {}); // start consumer
    deliverIdleAsync(session);

    await session.prompt({
      agent: 'builder',
      parts: [{ type: 'text', text: 'hello' }],
    });

    expect(mockSwitchAgent).toHaveBeenCalledWith({ sessionID: 'sess-123', agent: 'builder' });
    expect(mockPrompt).toHaveBeenCalledWith({ sessionID: 'sess-123', text: 'hello' });
  });

  it('maps model to switchModel and system to an instruction entry', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {});
    deliverIdleAsync(session);

    await session.prompt({
      agent: 'planner',
      parts: [{ type: 'text', text: 'design' }],
      model: { providerID: 'openai', modelID: 'gpt-4' },
      system: 'Be creative',
      tools: { task: false },
    });

    expect(mockSwitchModel).toHaveBeenCalledWith({
      sessionID: 'sess-123',
      model: { providerID: 'openai', id: 'gpt-4' },
    });
    expect(mockInstructionPut).toHaveBeenCalledWith({
      sessionID: 'sess-123',
      key: 'chatroom-role',
      value: 'Be creative',
    });
    expect(mockPrompt).toHaveBeenCalledWith({ sessionID: 'sess-123', text: 'design' });
  });

  it('throws when prompting a closed session', async () => {
    const session = createSession();
    await session.close();
    await expect(
      session.prompt({
        agent: 'builder',
        parts: [{ type: 'text', text: 'nope' }],
      })
    ).rejects.toThrow('Session is closed');
  });

  it('prompt() resolves when the execution terminal event arrives via _receiveEvent', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    const promptDone = session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });
    await new Promise<void>((r) => setTimeout(r, 5));

    session._receiveEvent({
      type: 'session.text.delta',
      data: { sessionID: 'sess-123', assistantMessageID: 'm1', ordinal: 0, delta: 'hello' },
    } as never);
    session._receiveEvent(turnDoneEvent() as never);

    await promptDone;
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(events.some((e) => e.type === 'session.text.delta')).toBe(true);
    expect(events.some((e) => e.type === 'session.execution.succeeded')).toBe(true);
  });

  it('prompt() rejects with the structured error when session.execution.failed arrives', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {}); // start consumer

    const promptDone = session.prompt({ agent: 'build', parts: [{ type: 'text', text: 'hi' }] });
    const assertion = expect(promptDone).rejects.toThrow('Agent not found: "build"');
    await new Promise<void>((r) => setTimeout(r, 5));

    session._receiveEvent({
      type: 'session.execution.failed',
      data: {
        sessionID: 'sess-123',
        error: { type: 'AgentNotFound', message: 'Agent not found: "build"' },
      },
    } as never);

    await assertion;
  });

  it('prompt() falls back to the error type when a failed execution has no message', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {});

    const promptDone = session.prompt({ agent: 'build', parts: [{ type: 'text', text: 'hi' }] });
    const assertion = expect(promptDone).rejects.toThrow('ProviderAuthError');
    await new Promise<void>((r) => setTimeout(r, 5));

    session._receiveEvent({
      type: 'session.execution.failed',
      data: { sessionID: 'sess-123', error: { type: 'ProviderAuthError', message: '' } },
    } as never);

    await assertion;
  });

  it('prompt() rejects when session.execution.interrupted arrives', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {});

    const promptDone = session.prompt({ agent: 'build', parts: [{ type: 'text', text: 'hi' }] });
    const assertion = expect(promptDone).rejects.toThrow('Session execution was interrupted');
    await new Promise<void>((r) => setTimeout(r, 5));

    session._receiveEvent({
      type: 'session.execution.interrupted',
      data: { sessionID: 'sess-123', reason: 'user' },
    } as never);

    await assertion;
  });

  it('a failed turn does not settle the next turn', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {});

    const first = session.prompt({ agent: 'build', parts: [{ type: 'text', text: 'one' }] });
    const firstAssertion = expect(first).rejects.toThrow('boom');
    await new Promise<void>((r) => setTimeout(r, 5));
    session._receiveEvent({
      type: 'session.execution.failed',
      data: { sessionID: 'sess-123', error: { type: 'Unknown', message: 'boom' } },
    } as never);
    await firstAssertion;

    // The second turn must wait for its own terminal event, not reuse the first turn's outcome.
    const second = session.prompt({ agent: 'build', parts: [{ type: 'text', text: 'two' }] });
    let secondSettled = false;
    void second.then(() => (secondSettled = true));
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(secondSettled).toBe(false);

    session._receiveEvent(turnDoneEvent() as never);
    await expect(second).resolves.toBeUndefined();
  });

  it('prompt() rejects when SSE idle times out', async () => {
    vi.useFakeTimers();
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    const promptDone = expect(
      session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] })
    ).rejects.toThrow('Timed out waiting for session execution to finish');
    await vi.advanceTimersByTimeAsync(300_001);
    await promptDone;

    expect(events.some((e) => e.type === 'session.idle')).toBe(false);
    vi.useRealTimers();
  });

  it('clears the turn timeout once the execution succeeds', async () => {
    vi.useFakeTimers();
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    session.onEvent(() => {});

    const promptDone = session.prompt({ agent: 'build', parts: [{ type: 'text', text: 'hi' }] });
    // Let the submission complete so the timeout is armed before the terminal event.
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    session._receiveEvent(turnDoneEvent() as never);
    await promptDone;

    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('arms no timeout when applying overrides throws, and nothing fires after 5 minutes', async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    mockSwitchAgent.mockRejectedValueOnce(new Error('switch failed'));

    const session = createSession();
    session.onEvent(() => {});

    await expect(
      session.prompt({ agent: 'build', parts: [{ type: 'text', text: 'hi' }] })
    ).rejects.toThrow('switch failed');
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(300_001);
    process.off('unhandledRejection', onUnhandled);
    vi.useRealTimers();

    expect(unhandled).toEqual([]);
  });

  it('arms no timeout when the prompt submission throws, and nothing fires after 5 minutes', async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    mockPrompt.mockRejectedValueOnce(new Error('submit failed'));

    const session = createSession();
    session.onEvent(() => {});

    await expect(session.prompt({ parts: [{ type: 'text', text: 'hi' }] })).rejects.toThrow(
      'submit failed'
    );
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(300_001);
    process.off('unhandledRejection', onUnhandled);
    vi.useRealTimers();

    expect(unhandled).toEqual([]);
  });

  // ── onEvent() / _receiveEvent() ─────────────────────────────────────────────
  //
  // Event delivery: harness SSE fan-out pushes events via _receiveEvent() into the
  // session buffer; the async consumer loop drains the buffer and dispatches to listeners.

  it('onEvent registers a listener and returns an unsubscribe function', async () => {
    const session = createSession();
    const listener = vi.fn();
    const unsub = session.onEvent(listener);

    session._receiveEvent(idleEvent() as never);
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(listener).toHaveBeenCalledOnce();

    unsub();
    session._receiveEvent({ type: 'server.connected', data: {} } as never);
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(listener).toHaveBeenCalledOnce(); // still 1
  });

  it('_receiveEvent dispatches to all registered listeners', async () => {
    const session = createSession();
    const a = vi.fn();
    const b = vi.fn();
    session.onEvent(a);
    session.onEvent(b);

    session._receiveEvent(idleEvent() as never);
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.idle' }));
  });

  it('_receiveEvent maps data to payload on the emitted event', async () => {
    const session = createSession();
    const listener = vi.fn();
    session.onEvent(listener);

    session._receiveEvent(idleEvent() as never);
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session.idle',
        payload: expect.objectContaining({ sessionID: 'sess-123' }),
      })
    );
  });

  // ── close() ─────────────────────────────────────────────────────────────────

  it('calls session.interrupt on close', async () => {
    mockInterrupt.mockResolvedValue({});

    const session = createSession();
    await session.close();

    expect(mockInterrupt).toHaveBeenCalledWith({ sessionID: 'sess-123' });
  });

  it('is idempotent — second close is a no-op', async () => {
    mockInterrupt.mockResolvedValue({});

    const session = createSession();
    await session.close();
    await session.close();

    expect(mockInterrupt).toHaveBeenCalledTimes(1);
  });

  it('swallows interrupt errors (best-effort abort)', async () => {
    mockInterrupt.mockRejectedValue(new Error('network error'));

    const session = createSession();
    await expect(session.close()).resolves.toBeUndefined();
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
    mockInterrupt.mockResolvedValue({});

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

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('session.updated');

    const newTitle = (updatedEvent.payload as { info?: { title?: string | undefined } | undefined })
      .info?.title;
    if (newTitle && newTitle !== session.sessionTitle) {
      session.setTitle(newTitle);
    }
    expect(session.sessionTitle).toBe('Debug the auth issue');
  });

  it('SSE events arrive before the execution terminal — all delivered to listeners', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    const promptDone = session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });
    await new Promise<void>((r) => setTimeout(r, 5));

    session._receiveEvent({
      type: 'session.text.delta',
      data: { sessionID: 'sess-123', assistantMessageID: 'm1', ordinal: 0, delta: 'chunk1' },
    } as never);
    session._receiveEvent(turnDoneEvent() as never);

    await promptDone;
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(events.some((e) => e.type === 'session.text.delta')).toBe(true);
    expect(events.some((e) => e.type === 'session.execution.succeeded')).toBe(true);
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

    session.onEvent((e) => received.push(e));

    session._receiveEvent(idleEvent() as never);
    session._receiveEvent(idleEvent() as never);
    session._receiveEvent(idleEvent() as never);

    await new Promise<void>((r) => setTimeout(r, 20));

    expect(received).toHaveLength(3);
    expect(received.every((e) => e.type === 'session.idle')).toBe(true);
  });

  it('buffer consumer: events pushed before listener registers are delivered when first onEvent registers', async () => {
    const session = createSession();

    session._receiveEvent(idleEvent() as never);
    session._receiveEvent(idleEvent() as never);

    const received: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => received.push(e));

    await new Promise<void>((r) => setTimeout(r, 20));

    expect(received).toHaveLength(2);
    expect(received[0]?.type).toBe('session.idle');
    expect(received[1]?.type).toBe('session.idle');
  });

  it('buffer consumer: pushing the execution terminal resolves an in-flight prompt()', async () => {
    mockPrompt.mockResolvedValue({});

    const session = createSession();
    const events: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => events.push(e));

    const promptDone = session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hi' }] });
    await new Promise<void>((r) => setTimeout(r, 10));

    session._receiveEvent(turnDoneEvent() as never);

    await promptDone;
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(events.some((e) => e.type === 'session.execution.succeeded')).toBe(true);
  });

  it('buffer consumer: close() drains pending buffered events to listeners before shutting down', async () => {
    mockInterrupt.mockResolvedValue({});

    const session = createSession();
    const received: DirectHarnessSessionEvent[] = [];
    session.onEvent((e) => received.push(e));

    session._receiveEvent(idleEvent() as never);
    session._receiveEvent(idleEvent() as never);

    await session.close();

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

    expect((session1 as unknown as { client: unknown }).client).toBe(
      (session2 as unknown as { client: unknown }).client
    );
  });
});
