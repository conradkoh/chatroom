import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { OpencodeSdkHarness, startOpencodeSdkHarness } from './opencode-harness.js';
import { OpencodeSdkSession } from './opencode-session.js';
import { TEST_MODEL_OPENCODE } from '../../../../../../testing/test-models.js';
import type { OpenCodeSessionId } from '../../../../../domain/entities/harness-session.js';
import { waitForListeningUrl } from '../../services/opencode-sdk/parse-listening-url.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockGet = vi.fn();
const mockInterrupt = vi.fn();
const mockSessionPrompt = vi.fn();
const mockAgentList = vi.fn();
const mockProviderList = vi.fn();
const mockModelList = vi.fn();
const mockEventSubscribe = vi.fn();
const harnesses = new Set<OpencodeSdkHarness>();

function makeClient() {
  return {
    session: {
      create: mockCreate,
      get: mockGet,
      interrupt: mockInterrupt,
      prompt: mockSessionPrompt,
    },
    agent: { list: mockAgentList },
    provider: { list: mockProviderList },
    model: { list: mockModelList },
    event: { subscribe: mockEventSubscribe },
  };
}

vi.mock('@opencode/client', () => ({
  OpenCode: {
    make: vi.fn(() => makeClient()),
  },
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & {
      pid: number;
      exitCode: number | null;
      killed: boolean;
      kill: ReturnType<typeof vi.fn>;
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: EventEmitter;
    };
    proc.pid = 12345;
    proc.exitCode = null;
    proc.killed = false;
    proc.kill = vi.fn((signal?: string) => {
      proc.killed = true;
      proc.exitCode = null;
      setImmediate(() => proc.emit('exit', null, signal ?? 'SIGTERM'));
    });
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = new EventEmitter();
    return proc;
  }),
}));

vi.mock('../../services/opencode-sdk/parse-listening-url.js', () => ({
  waitForListeningUrl: vi.fn(() => Promise.resolve({ url: 'http://127.0.0.1:15432' })),
  serverAuthHeaders: vi.fn(() => undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MockProcess {
  pid: number;
  exitCode: number | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter;
}

function makeProcess(overrides?: Partial<MockProcess>): MockProcess & EventEmitter {
  const proc = new EventEmitter() as EventEmitter & MockProcess;
  proc.pid = 12345;
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = vi.fn((signal?: string) => {
    proc.killed = true;
    proc.exitCode = null;
    setImmediate(() => proc.emit('exit', null, signal ?? 'SIGTERM'));
  });
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  Object.assign(proc, overrides);
  return proc;
}

function createHarness(overrides?: {
  baseUrl?: string | undefined;
  cwd?: string | undefined;
  client?: Record<string, unknown> | undefined;
  process?: (MockProcess & EventEmitter) | undefined;
}) {
  const proc = overrides?.process ?? makeProcess();
  const harness = new OpencodeSdkHarness({
    baseUrl: overrides?.baseUrl ?? 'http://127.0.0.1:19999',
    cwd: overrides?.cwd ?? '/test/workspace',
    client: (overrides?.client ?? makeClient()) as never,
    process: proc as unknown as ChildProcess,
  });
  harnesses.add(harness);
  return harness;
}

/** An SSE stream that only ends when the abort signal fires. */
function makeAbortableStream(signal: AbortSignal): AsyncIterable<unknown> {
  return (async function* () {
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
  })();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpencodeSdkHarness', () => {
  afterEach(async () => {
    for (const harness of harnesses) await harness.close();
    harnesses.clear();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventSubscribe.mockReset();
    mockEventSubscribe.mockImplementation((options: { signal: AbortSignal }) =>
      makeAbortableStream(options.signal)
    );
    mockProviderList.mockResolvedValue({
      data: [
        { id: 'openai', name: 'OpenAI' },
        { id: 'opencode', name: 'OpenCode' },
      ],
    });
    mockModelList.mockResolvedValue({
      data: [
        { providerID: 'openai', modelID: 'gpt-4', id: 'gpt-4', name: 'GPT-4', enabled: true },
        {
          providerID: 'opencode',
          modelID: 'big-pickle',
          id: 'big-pickle',
          name: 'Big Pickle',
          enabled: true,
        },
      ],
    });
  });

  // ── models() ────────────────────────────────────────────────────────────────

  it('returns flattened models from model.list', async () => {
    const harness = createHarness();
    const models = await harness.models();

    expect(mockModelList).toHaveBeenCalledOnce();
    expect(models).toEqual([
      { id: 'openai/gpt-4', name: 'GPT-4', provider: 'openai' },
      { id: 'opencode/big-pickle', name: 'Big Pickle', provider: 'opencode' },
    ]);
  });

  it('returns empty array when no models', async () => {
    mockModelList.mockResolvedValue({ data: [] });
    const harness = createHarness();
    const models = await harness.models();
    expect(models).toEqual([]);
  });

  // ── listProviders() ─────────────────────────────────────────────────────────

  it('expands variant tags in listProviders', async () => {
    mockProviderList.mockResolvedValue({
      data: [{ id: 'opencode-go', name: 'OpenCode Go' }],
    });
    mockModelList.mockResolvedValue({
      data: [
        {
          providerID: 'opencode-go',
          modelID: 'gpt-5.6-luna',
          id: 'gpt-5.6-luna',
          name: 'GPT 5.6 Luna',
          enabled: true,
          variants: [{ id: 'default' }, { id: 'max' }],
        },
      ],
    });

    const harness = createHarness();
    const providers = await harness.listProviders();

    expect(providers).toEqual([
      {
        providerID: 'opencode-go',
        name: 'OpenCode Go',
        models: [
          { modelID: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' },
          { modelID: 'gpt-5.6-luna[variant=max]', name: 'GPT 5.6 Luna (max)' },
        ],
      },
    ]);
  });

  // ── listAgents() ────────────────────────────────────────────────────────────

  it('listAgents publishes agent ids, not display names', async () => {
    mockAgentList.mockResolvedValue({
      data: [{ id: 'build', name: 'Build', mode: 'primary', hidden: false }],
    });

    const harness = createHarness();
    const agents = await harness.listAgents();

    expect(agents).toEqual([{ name: 'build', mode: 'primary' }]);
  });

  it('listAgents drops hidden agents and keeps descriptions', async () => {
    mockAgentList.mockResolvedValue({
      data: [
        { id: 'build', name: 'Build', mode: 'primary', description: 'Default agent' },
        { id: 'internal', name: 'Internal', mode: 'subagent', hidden: true },
      ],
    });

    const harness = createHarness();
    const agents = await harness.listAgents();

    expect(agents).toEqual([{ name: 'build', mode: 'primary', description: 'Default agent' }]);
  });

  // ── newSession() ────────────────────────────────────────────────────────────

  it('creates a new session and returns an OpencodeSdkSession', async () => {
    mockCreate.mockResolvedValue({ id: 'sess-456' });
    mockGet.mockResolvedValue({ title: 'My Session' });

    const harness = createHarness();
    const session = await harness.newSession({ title: 'My Session', model: TEST_MODEL_OPENCODE });

    expect(mockCreate).toHaveBeenCalledWith({
      title: 'My Session',
      location: { directory: '/test/workspace' },
    });

    // Fetches the title from the harness
    expect(mockGet).toHaveBeenCalledWith({ sessionID: 'sess-456' });

    expect(session.opencodeSessionId).toBe('sess-456');
    expect(session.sessionTitle).toBe('My Session');
  });

  it('creates session without title', async () => {
    mockCreate.mockResolvedValue({ id: 'sess-789' });
    mockGet.mockResolvedValue({ title: 'Auto-generated' });

    const harness = createHarness();
    const session = await harness.newSession({ model: TEST_MODEL_OPENCODE });

    expect(mockCreate).toHaveBeenCalledWith({ location: { directory: '/test/workspace' } });

    expect(session.opencodeSessionId).toBe('sess-789');
    expect(session.sessionTitle).toBe('Auto-generated');
  });

  it('falls back to empty title when session.get fails', async () => {
    mockCreate.mockResolvedValue({ id: 'sess-xyz' });
    mockGet.mockRejectedValue(new Error('not found'));

    const harness = createHarness();
    const session = await harness.newSession({ model: TEST_MODEL_OPENCODE });

    expect(session.sessionTitle).toBe('');
  });

  it('throws when session.create returns no ID', async () => {
    mockCreate.mockResolvedValue({});

    const harness = createHarness();
    await expect(harness.newSession({ model: TEST_MODEL_OPENCODE })).rejects.toThrow(
      'no session ID returned'
    );
  });

  it('throws when creating session on closed harness', async () => {
    const harness = createHarness();
    await harness.close();
    await expect(harness.newSession({ model: TEST_MODEL_OPENCODE })).rejects.toThrow(
      'Harness is closed'
    );
  });

  // ── resumeSession() ─────────────────────────────────────────────────────────

  it('verifies session exists and returns an OpencodeSdkSession', async () => {
    mockGet.mockResolvedValue({ title: 'Existing Session' });

    const harness = createHarness();
    const session = await harness.resumeSession('sess-existing' as OpenCodeSessionId);

    expect(mockGet).toHaveBeenCalledWith({ sessionID: 'sess-existing' });
    expect(session.opencodeSessionId).toBe('sess-existing');
    expect(session.sessionTitle).toBe('Existing Session');
  });

  it('throws when resumed session does not exist', async () => {
    mockGet.mockRejectedValue(new Error('not found'));

    const harness = createHarness();
    await expect(harness.resumeSession('sess-gone' as OpenCodeSessionId)).rejects.toThrow(
      'Session sess-gone not found on the harness'
    );
  });

  it('throws when resuming session on closed harness', async () => {
    const harness = createHarness();
    await harness.close();
    await expect(harness.resumeSession('sess-any' as OpenCodeSessionId)).rejects.toThrow(
      'Harness is closed'
    );
  });

  // ── isAlive() ───────────────────────────────────────────────────────────────

  it('returns true for a running process', () => {
    const harness = createHarness();
    expect(harness.isAlive()).toBe(true);
  });

  it('returns false after close', async () => {
    const harness = createHarness();
    expect(harness.isAlive()).toBe(true);
    await harness.close();
    expect(harness.isAlive()).toBe(false);
  });

  it('returns false when process exited', () => {
    const proc = makeProcess();
    const harness = createHarness({ process: proc });
    proc.exitCode = 0;
    expect(harness.isAlive()).toBe(false);
  });

  it('returns false when process killed', () => {
    const proc = makeProcess();
    const harness = createHarness({ process: proc });
    proc.killed = true;
    expect(harness.isAlive()).toBe(false);
  });

  // ── close() ─────────────────────────────────────────────────────────────────

  it('kills the child process with SIGTERM', async () => {
    const proc = makeProcess();
    const harness = createHarness({ process: proc });

    await harness.close();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('is idempotent — second close is a no-op', async () => {
    const proc = makeProcess();
    const harness = createHarness({ process: proc });

    await harness.close();
    await harness.close();

    expect(proc.kill).toHaveBeenCalledTimes(1);
  });

  // ── startOpencodeSdkHarness factory ─────────────────────────────────────────

  it('spawns process and creates harness via factory', async () => {
    const proc = makeProcess();
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(proc);

    const harness = await startOpencodeSdkHarness({
      harnessName: 'opencode-sdk',
      workingDir: '/test/ws',
      workspaceId: 'ws-1',
      resolvedConvexUrl: 'http://test:3210',
    });
    if (harness instanceof OpencodeSdkHarness) harnesses.add(harness);
    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      ['serve', '--print-logs', '--log-level', 'warn'],
      expect.objectContaining({ cwd: '/test/ws' })
    );
    expect(waitForListeningUrl).toHaveBeenCalled();
    expect(harness).toBeInstanceOf(OpencodeSdkHarness);
    expect(harness.isAlive()).toBe(true);
  });

  it('kills process on startup failure', async () => {
    const proc = makeProcess();
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(proc);
    (waitForListeningUrl as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

    await expect(
      startOpencodeSdkHarness({
        harnessName: 'opencode-sdk',
        workingDir: '/test/ws',
        workspaceId: 'ws-1',
        resolvedConvexUrl: 'http://test:3210',
      })
    ).rejects.toThrow('timeout');

    // The process should have been killed
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  // ── properties ──────────────────────────────────────────────────────────────

  it('exposes type', () => {
    const harness = createHarness();
    expect(harness.type).toBe('opencode-sdk');
  });
});

// ─── SSE Fan-out Tests ────────────────────────────────────────────────────────

describe('OpencodeSdkHarness — SSE fan-out (Effect fiber)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventSubscribe.mockReset();
    mockEventSubscribe.mockImplementation((options: { signal: AbortSignal }) =>
      makeAbortableStream(options.signal)
    );
  });

  afterEach(async () => {
    for (const harness of harnesses) await harness.close();
    harnesses.clear();
    vi.useRealTimers();
  });

  function makeEmptyStream() {
    return (async function* () {
      // empty — ends immediately
    })();
  }

  /** V2 events are yielded directly (no global-event envelope). */
  function makeEventStream(events: unknown[]) {
    return (async function* () {
      for (const e of events) yield e;
    })();
  }

  it('routes events to the correct session by sessionID via _receiveEvent', () => {
    const harness = createHarness();

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    const mockSessionA = { _receiveEvent: (e: unknown) => receivedA.push(e) } as any;
    const mockSessionB = { _receiveEvent: (e: unknown) => receivedB.push(e) } as any;

    harness.registerSessionListener('sess-a', mockSessionA);
    harness.registerSessionListener('sess-b', mockSessionB);

    const sessionListeners = (harness as any).sessionListeners as Map<string, any>;
    const dispatchEvent = (raw: { type: string; data?: Record<string, unknown> | undefined }) => {
      const p = raw.data;
      const sid = p && 'sessionID' in p ? p['sessionID'] : undefined;
      if (typeof sid === 'string') sessionListeners.get(sid)?._receiveEvent(raw);
    };

    dispatchEvent({ type: 'msg', data: { sessionID: 'sess-a' } });
    dispatchEvent({ type: 'msg', data: { sessionID: 'sess-b' } });
    dispatchEvent({ type: 'msg', data: { sessionID: 'sess-a' } });

    expect(receivedA).toHaveLength(2);
    expect(receivedB).toHaveLength(1);
  });

  it('registers first session → forks exactly one SSE fiber (_sseFiber is non-null)', () => {
    const harness = createHarness();
    expect((harness as any)._sseFiber).toBeNull();

    harness.registerSessionListener('sess-1', { _receiveEvent: vi.fn() } as any);
    expect((harness as any)._sseFiber).not.toBeNull();
  });

  it('registering 3 sessions concurrently forks exactly one fiber (not 3)', () => {
    const harness = createHarness();
    harness.registerSessionListener('sess-a', { _receiveEvent: vi.fn() } as any);
    harness.registerSessionListener('sess-b', { _receiveEvent: vi.fn() } as any);
    harness.registerSessionListener('sess-c', { _receiveEvent: vi.fn() } as any);

    expect((harness as any)._sseFiber).not.toBeNull();
    const subscribeCallCount = (harness as any)._subscribeCallCount;
    expect(subscribeCallCount).toBeLessThanOrEqual(1); // ≤1 in synchronous scope
  });

  it('shares one abortable stream and waits for its cleanup when the last listener unregisters', async () => {
    let capturedSignal: AbortSignal | undefined;
    let finishCleanup!: () => void;
    let releaseStream: (() => void) | undefined;
    let cleanedUp = false;
    const cleaned = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    mockEventSubscribe.mockImplementation((options: { signal: AbortSignal }) => {
      capturedSignal = options.signal;
      return (async function* () {
        try {
          await new Promise<void>((resolve) => {
            releaseStream = resolve;
            if (options.signal.aborted) resolve();
            else options.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        } finally {
          cleanedUp = true;
          finishCleanup();
        }
      })();
    });

    const harness = createHarness();
    const sessionA = new OpencodeSdkSession({
      client: makeClient() as never,
      opencodeSessionId: 'sess-a',
      sessionTitle: '',
      cwd: '/test/workspace',
    });
    const sessionB = new OpencodeSdkSession({
      client: makeClient() as never,
      opencodeSessionId: 'sess-b',
      sessionTitle: '',
      cwd: '/test/workspace',
    });
    const receiveA = vi.spyOn(sessionA, '_receiveEvent');
    const receiveB = vi.spyOn(sessionB, '_receiveEvent');
    harness.registerSessionListener('sess-a', sessionA);
    harness.registerSessionListener('sess-b', sessionB);

    try {
      await vi.waitFor(() => expect(capturedSignal).toBeDefined());
      await vi.waitFor(() => expect(releaseStream).toBeTypeOf('function'));
      expect(mockEventSubscribe).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);

      harness.unregisterSessionListener('sess-a');
      expect(capturedSignal?.aborted).toBe(false);
      harness.unregisterSessionListener('sess-b');
      await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true));
      await cleaned;
      expect(receiveA).not.toHaveBeenCalled();
      expect(receiveB).not.toHaveBeenCalled();
      expect({ aborted: capturedSignal?.aborted, cleanedUp }).toEqual({
        aborted: true,
        cleanedUp: true,
      });
      expect(mockEventSubscribe).toHaveBeenCalledTimes(1);
    } finally {
      releaseStream?.();
      if (releaseStream !== undefined) await cleaned;
      await harness.close();
    }
  });

  it('close aborts an active stream, waits for cleanup, and prevents reconnect', async () => {
    let capturedSignal: AbortSignal | undefined;
    let finishCleanup!: () => void;
    let releaseStream: (() => void) | undefined;
    let cleanedUp = false;
    let listenerCalls = 0;
    const received = vi.fn();
    const cleaned = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    mockEventSubscribe.mockImplementation((options: { signal: AbortSignal }) => {
      capturedSignal = options.signal;
      return (async function* () {
        try {
          await new Promise<void>((resolve) => {
            releaseStream = resolve;
            if (options.signal.aborted) resolve();
            else options.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          yield { type: 'session.idle', data: { sessionID: 'sess-close' } };
        } finally {
          cleanedUp = true;
          finishCleanup();
        }
      })();
    });

    const harness = createHarness();
    const session = new OpencodeSdkSession({
      client: makeClient() as never,
      opencodeSessionId: 'sess-close',
      sessionTitle: '',
      cwd: '/test/workspace',
    });
    const receiveEvent = vi.spyOn(session, '_receiveEvent').mockImplementation((event) => {
      listenerCalls++;
      received(event);
    });
    harness.registerSessionListener('sess-close', session);

    try {
      await vi.waitFor(() => expect(capturedSignal).toBeDefined());
      await vi.waitFor(() => expect(releaseStream).toBeTypeOf('function'));
      await harness.close();
      expect(listenerCalls).toBe(0);
      expect(receiveEvent).not.toHaveBeenCalled();
      expect(mockEventSubscribe).toHaveBeenCalledTimes(1);
      expect(received).not.toHaveBeenCalled();
      expect({ aborted: capturedSignal?.aborted, cleanedUp }).toEqual({
        aborted: true,
        cleanedUp: true,
      });
    } finally {
      releaseStream?.();
      if (releaseStream !== undefined) await cleaned;
      await harness.close();
    }
  });

  it('fiber calls subscribe once and routes events to matching session listener', async () => {
    const received: unknown[] = [];
    const mockSession = { _receiveEvent: (e: unknown) => received.push(e) } as any;

    mockEventSubscribe.mockReturnValue(
      makeEventStream([
        { type: 'session.idle', data: { sessionID: 'sess-target' } },
        { type: 'session.idle', data: { sessionID: 'other-sess' } },
      ])
    );

    const harness = createHarness();
    harness.registerSessionListener('sess-target', mockSession);

    await new Promise<void>((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect((received[0] as any).data.sessionID).toBe('sess-target');
  });

  it('fiber resubscribes when stream ends (subscribe called again after backoff)', async () => {
    let callCount = 0;
    mockEventSubscribe.mockImplementation(() => {
      callCount++;
      if (callCount >= 3) {
        harness.unregisterSessionListener('sess-test');
      }
      return makeEmptyStream();
    });

    const harness = createHarness();
    harness.registerSessionListener('sess-test', { _receiveEvent: vi.fn() } as any);

    await new Promise<void>((r) => setTimeout(r, 1200));

    expect(callCount).toBeGreaterThanOrEqual(2);
  }, 5000);

  it('unregistering the last session clears the fiber reference', () => {
    const harness = createHarness();
    const sid = 'sess-test';
    const mockSession = { _receiveEvent: vi.fn() } as any;

    harness.registerSessionListener(sid, mockSession);
    expect((harness as any)._sseFiber).not.toBeNull();

    harness.unregisterSessionListener(sid);
    expect((harness as any)._sseFiber).toBeNull();
    expect((harness as any).sessionListeners.size).toBe(0);
  });

  it('close() interrupts the fiber and clears listeners', async () => {
    const harness = createHarness();
    const sid = 'sess-close-test';
    const mockSession = { _receiveEvent: vi.fn() } as any;

    harness.registerSessionListener(sid, mockSession);
    expect((harness as any)._sseFiber).not.toBeNull();

    (harness as any).childProcess.kill = vi.fn();
    (harness as any).childProcess.once = vi
      .fn()
      .mockImplementation((_event: string, cb: () => void) => setTimeout(cb, 0));

    await harness.close();

    expect((harness as any)._sseFiber).toBeNull();
    expect((harness as any).sessionListeners.size).toBe(0);
  });

  it('close() is idempotent when no fiber was started', async () => {
    const harness = createHarness();
    expect((harness as any)._sseFiber).toBeNull();

    (harness as any).childProcess.kill = vi.fn();
    (harness as any).childProcess.once = vi
      .fn()
      .mockImplementation((_event: string, cb: () => void) => setTimeout(cb, 0));

    await harness.close();
    expect((harness as any)._sseFiber).toBeNull();
  });
});
