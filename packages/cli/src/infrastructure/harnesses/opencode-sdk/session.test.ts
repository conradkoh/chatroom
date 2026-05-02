import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OpencodeSdkDirectHarnessSession,
  subscribeToSessionEvents,
  type OpencodeSdkSessionClient,
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

  const client: OpencodeSdkSessionClient = {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: 'mock-session' } }),
      promptAsync: promptAsyncFn,
      abort: abortFn,
    },
    event: { subscribe: subscribeFn },
    app: { agents: vi.fn().mockResolvedValue({ data: [] }) },
    config: { providers: vi.fn().mockResolvedValue({ data: { providers: [] } }) },
  };

  return { client, promptAsyncFn, abortFn, subscribeFn };
}

function createSession(
  overrideClient?: Partial<OpencodeSdkSessionClient>,
  killProcess?: () => void
) {
  const { client } = createMockClient();
  const mergedClient: OpencodeSdkSessionClient = { ...client, ...overrideClient };
  const stopFn = vi.fn();
  const session = new OpencodeSdkDirectHarnessSession(
    HARNESS_SESSION_ID,
    mergedClient,
    stopFn,
    killProcess
  );
  return { session, stopFn, client: mergedClient };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OpencodeSdkDirectHarnessSession', () => {
  it('exposes the correct harnessSessionId', () => {
    const { session } = createSession();
    expect(session.harnessSessionId).toBe(HARNESS_SESSION_ID);
  });

  it('prompt() calls client.session.promptAsync with agent and parts', async () => {
    const promptAsyncFn = vi.fn().mockResolvedValue(undefined);
    const { session } = createSession({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'mock-session' } }),
        promptAsync: promptAsyncFn,
        abort: vi.fn(),
      },
    });

    await session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'hello world' }] });

    expect(promptAsyncFn).toHaveBeenCalledOnce();
    const args = promptAsyncFn.mock.calls[0][0];
    expect(args.path.id).toBe(HARNESS_SESSION_ID);
    expect(args.body.parts).toEqual([{ type: 'text', text: 'hello world' }]);
    expect(args.body.agent).toBe('builder');
  });

  it('prompt() passes model, system, tools override fields to SDK body', async () => {
    const promptAsyncFn = vi.fn().mockResolvedValue(undefined);
    const { session } = createSession({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'mock-session' } }),
        promptAsync: promptAsyncFn,
        abort: vi.fn(),
      },
    });

    await session.prompt({
      agent: 'builder',
      model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
      system: 'You are a helpful assistant',
      tools: { bash: true },
      parts: [{ type: 'text', text: 'hello' }],
    });

    const body = promptAsyncFn.mock.calls[0][0].body;
    expect(body.agent).toBe('builder');
    expect(body.model).toEqual({ providerID: 'anthropic', modelID: 'claude-3-5-sonnet' });
    expect(body.system).toBe('You are a helpful assistant');
    expect(body.tools).toEqual({ bash: true });
  });

  it('prompt() throws when agent is empty', async () => {
    const { session } = createSession();
    await expect(
      session.prompt({ agent: '', parts: [{ type: 'text', text: 'hello' }] })
    ).rejects.toThrow(/agent is required/);
  });

  it('prompt() throws when the session is closed', async () => {
    const { session } = createSession();
    await session.close();
    await expect(
      session.prompt({ agent: 'builder', parts: [{ type: 'text', text: 'too late' }] })
    ).rejects.toThrow('closed');
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
    const { session, stopFn } = createSession({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'mock-session' } }),
        promptAsync: vi.fn(),
        abort: abortFn,
      },
    });

    await session.close();

    expect(stopFn).toHaveBeenCalled();
    expect(abortFn).toHaveBeenCalled();
  });

  it('close() is idempotent — second call is a no-op', async () => {
    const abortFn = vi.fn().mockResolvedValue(undefined);
    const { session } = createSession({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'mock-session' } }),
        promptAsync: vi.fn(),
        abort: abortFn,
      },
    });

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

    subscribeFn.mockResolvedValue({
      stream: (async function* () {
        yield { type: 'tool_use', properties: { tool: 'bash' } };
      })(),
    });

    // Re-create session pointing at mocked client
    const stop = subscribeToSessionEvents(client, session, () => 999);

    // Wait for the async generator to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'tool_use',
      payload: { tool: 'bash' },
      timestamp: 999,
    });

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
        await new Promise<void>((r) => {
          yieldSecond = r;
        });
        yield { type: 'second', properties: {} };
      })(),
    });

    const stop = subscribeToSessionEvents(client, session, Date.now);
    await new Promise((r) => setTimeout(r, 10));

    stop();
    yieldSecond();
    await new Promise((r) => setTimeout(r, 10));

    expect(received.map((e: any) => e.type)).toEqual(['first']);
  });
});
