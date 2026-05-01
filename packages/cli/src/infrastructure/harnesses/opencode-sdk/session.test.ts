import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OpencodeSdkDirectHarnessSession,
  subscribeToSessionEvents,
} from './session.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HARNESS_SESSION_ID = 'sdk-session-abc' as HarnessSessionId;

function createMockClient() {
  const promptAsyncFn = vi.fn().mockResolvedValue(undefined);
  const abortFn = vi.fn().mockResolvedValue(undefined);
  const subscribeFn = vi.fn().mockResolvedValue({
    stream: (async function* () {
      // immediately end stream
    })(),
  });

  return {
    client: {
      session: { promptAsync: promptAsyncFn, abort: abortFn },
      event: { subscribe: subscribeFn },
    },
    promptAsyncFn,
    abortFn,
    subscribeFn,
  };
}

function createSession(
  clientOverrides?: Partial<ReturnType<typeof createMockClient>['client']>,
  killProcess?: () => void
) {
  const { client } = createMockClient();
  const mergedClient = { ...client, ...clientOverrides };
  const stopFn = vi.fn();
  const session = new OpencodeSdkDirectHarnessSession(
    HARNESS_SESSION_ID,
    mergedClient,
    stopFn,
    killProcess,
  );
  return { session, stopFn };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OpencodeSdkDirectHarnessSession', () => {
  it('exposes the correct harnessSessionId', () => {
    const { session } = createSession();
    expect(session.harnessSessionId).toBe(HARNESS_SESSION_ID);
  });

  it('send() calls client.session.promptAsync with the input', async () => {
    const promptAsyncFn = vi.fn().mockResolvedValue(undefined);
    const { client } = createMockClient();
    const { session } = createSession({ session: { ...client.session, promptAsync: promptAsyncFn } });

    await session.send('hello world');

    expect(promptAsyncFn).toHaveBeenCalledOnce();
    const args = promptAsyncFn.mock.calls[0][0];
    expect(args.path.id).toBe(HARNESS_SESSION_ID);
    expect(args.body.parts).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('send() throws when the session is closed', async () => {
    const { session } = createSession();
    await session.close();
    await expect(session.send('too late')).rejects.toThrow('closed');
  });

  it('onEvent() delivers forwarded events to the listener', () => {
    const { session } = createSession();
    const received: unknown[] = [];
    session.onEvent((e) => received.push(e));

    session._emit('message', { text: 'hi' }, 42);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: 'message', payload: { text: 'hi' }, timestamp: 42 });
  });

  it('onEvent() unsubscribe stops delivery', () => {
    const { session } = createSession();
    const received: unknown[] = [];
    const unsub = session.onEvent((e) => received.push(e));

    session._emit('a', {}, 1);
    unsub();
    session._emit('b', {}, 2);

    expect(received).toHaveLength(1);
  });

  it('close() calls stopEventStream and abort', async () => {
    const abortFn = vi.fn().mockResolvedValue(undefined);
    const { client } = createMockClient();
    const { session, stopFn } = createSession({ session: { ...client.session, abort: abortFn } });

    await session.close();

    expect(stopFn).toHaveBeenCalled();
    expect(abortFn).toHaveBeenCalled();
  });

  it('close() is idempotent — second call is a no-op', async () => {
    const abortFn = vi.fn().mockResolvedValue(undefined);
    const { client } = createMockClient();
    const { session } = createSession({ session: { ...client.session, abort: abortFn } });

    await session.close();
    await session.close();

    expect(abortFn).toHaveBeenCalledOnce();
  });

  it('close() calls killProcess when provided', async () => {
    const killFn = vi.fn();
    const { session } = createSession(undefined, killFn);
    await session.close();
    expect(killFn).toHaveBeenCalled();
  });
});

describe('subscribeToSessionEvents', () => {
  it('forwards stream events to the session', async () => {
    const received: unknown[] = [];
    const { client, subscribeFn } = createMockClient();
    const { session } = createSession();
    session.onEvent((e) => received.push(e));

    // Provide a stream that yields one event
    subscribeFn.mockResolvedValue({
      stream: (async function* () {
        yield { type: 'tool_use', properties: { tool: 'bash' } };
      })(),
    });

    const stop = subscribeToSessionEvents(client, session, () => 999);

    // Wait for the async generator to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'tool_use', payload: { tool: 'bash' }, timestamp: 999 });

    stop();
  });

  it('stop() prevents further event delivery', async () => {
    const received: unknown[] = [];
    const { client, subscribeFn } = createMockClient();
    const { session } = createSession();
    session.onEvent((e) => received.push(e));

    let yieldSecond!: () => void;
    subscribeFn.mockResolvedValue({
      stream: (async function* () {
        yield { type: 'first', properties: {} };
        await new Promise<void>((r) => { yieldSecond = r; });
        yield { type: 'second', properties: {} };
      })(),
    });

    const stop = subscribeToSessionEvents(client, session, Date.now);
    await new Promise((r) => setTimeout(r, 10));

    // Stop before second event
    stop();
    yieldSecond();
    await new Promise((r) => setTimeout(r, 10));

    // Only first event delivered
    expect(received.map((e: any) => e.type)).toEqual(['first']);
  });
});
