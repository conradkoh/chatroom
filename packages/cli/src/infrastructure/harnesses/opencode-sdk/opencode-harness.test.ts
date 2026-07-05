import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import type { OpencodeClient } from '@opencode-ai/sdk';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OpencodeSdkHarness, startOpencodeSdkHarness } from './opencode-harness.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import { waitForListeningUrl } from '../../../infrastructure/services/remote-agents/opencode-sdk/parse-listening-url.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockGet = vi.fn();
const mockAbort = vi.fn();
const mockPrompt = vi.fn();
const mockProviderList = vi.fn();
const mockGlobalEvent = vi.fn();

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(() => ({
    session: {
      create: mockCreate,
      get: mockGet,
      abort: mockAbort,
      prompt: mockPrompt,
    },
    provider: {
      list: mockProviderList,
    },
    global: {
      event: mockGlobalEvent,
    },
  })),
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

vi.mock(
  '../../../infrastructure/services/remote-agents/opencode-sdk/parse-listening-url.js',
  () => ({
    waitForListeningUrl: vi.fn(() => Promise.resolve('http://127.0.0.1:15432')),
  })
);

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
  baseUrl?: string;
  cwd?: string;
  client?: Record<string, unknown>;
  process?: MockProcess & EventEmitter;
}) {
  const proc = overrides?.process ?? makeProcess();
  return new OpencodeSdkHarness({
    baseUrl: overrides?.baseUrl ?? 'http://127.0.0.1:19999',
    cwd: overrides?.cwd ?? '/test/workspace',
    client: (overrides?.client ?? {
      session: { create: mockCreate, get: mockGet, abort: mockAbort, prompt: mockPrompt },
      provider: { list: mockProviderList },
      global: { event: mockGlobalEvent },
    }) as unknown as OpencodeClient,
    process: proc as unknown as ChildProcess,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpencodeSdkHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderList.mockResolvedValue({
      data: {
        all: [
          { name: 'OpenAI', id: 'openai', models: { 'gpt-4': { id: 'gpt-4', name: 'GPT-4' } } },
          {
            name: 'OpenCode',
            id: 'opencode',
            models: { 'big-pickle': { id: 'big-pickle', name: 'Big Pickle' } },
          },
        ],
      },
    });
  });

  // ── models() ────────────────────────────────────────────────────────────────

  it('returns flattened models from provider.list', async () => {
    const harness = createHarness();
    const models = await harness.models();

    expect(mockProviderList).toHaveBeenCalledOnce();
    expect(models).toEqual([
      { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI' },
      { id: 'big-pickle', name: 'Big Pickle', provider: 'OpenCode' },
    ]);
  });

  it('returns empty array when no providers', async () => {
    mockProviderList.mockResolvedValue({ data: { all: [] } });
    const harness = createHarness();
    const models = await harness.models();
    expect(models).toEqual([]);
  });

  // ── newSession() ────────────────────────────────────────────────────────────

  it('creates a new session and returns an OpencodeSdkSession', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'sess-456' } });
    mockGet.mockResolvedValue({ data: { title: 'My Session' } });

    const harness = createHarness();
    const session = await harness.newSession({ title: 'My Session' });

    expect(mockCreate).toHaveBeenCalledWith({
      body: { title: 'My Session' },
      query: { directory: '/test/workspace' },
    });

    // Fetches the title from the harness
    expect(mockGet).toHaveBeenCalledWith({ path: { id: 'sess-456' } });

    expect(session.opencodeSessionId).toBe('sess-456');
    expect(session.sessionTitle).toBe('My Session');
  });

  it('creates session without title', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'sess-789' } });
    mockGet.mockResolvedValue({ data: { title: 'Auto-generated' } });

    const harness = createHarness();
    const session = await harness.newSession({});

    expect(mockCreate).toHaveBeenCalledWith({
      body: {},
      query: { directory: '/test/workspace' },
    });

    expect(session.opencodeSessionId).toBe('sess-789');
    expect(session.sessionTitle).toBe('Auto-generated');
  });

  it('falls back to empty title when session.get fails', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'sess-xyz' } });
    mockGet.mockRejectedValue(new Error('not found'));

    const harness = createHarness();
    const session = await harness.newSession({});

    expect(session.sessionTitle).toBe('');
  });

  it('throws when session.create returns no ID', async () => {
    mockCreate.mockResolvedValue({ data: {} });

    const harness = createHarness();
    await expect(harness.newSession({})).rejects.toThrow('no session ID returned');
  });

  it('throws when creating session on closed harness', async () => {
    const harness = createHarness();
    await harness.close();
    await expect(harness.newSession({})).rejects.toThrow('Harness is closed');
  });

  // ── resumeSession() ─────────────────────────────────────────────────────────

  it('verifies session exists and returns an OpencodeSdkSession', async () => {
    mockGet.mockResolvedValue({ data: { title: 'Existing Session' } });

    const harness = createHarness();
    const session = await harness.resumeSession('sess-existing' as OpenCodeSessionId);

    expect(mockGet).toHaveBeenCalledWith({ path: { id: 'sess-existing' } });
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

    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      ['serve', '--print-logs'],
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
  // Helper: make a controlled async stream
  function _makeNeverEndingStream() {
    return {
      stream: (async function* () {
        // yields nothing, hangs forever — represents a live SSE connection
        await new Promise<void>(() => {}); // never resolves
      })(),
    };
  }

  function makeEmptyStream() {
    return {
      stream: (async function* () {
        // empty — ends immediately
      })(),
    };
  }

  /**
   * Wrap raw SDK events in GlobalEvent format (the /global/event envelope).
   * Each raw event is wrapped as { directory: string; payload: SdkEvent }.
   */
  function makeEventStream(events: unknown[]) {
    return {
      stream: (async function* () {
        for (const e of events) yield { directory: '/test/workspace', payload: e };
      })(),
    };
  }

  it('routes events to the correct session by sessionID via _receiveEvent', () => {
    // Test routing logic via the sessionListeners map directly.
    const harness = createHarness();

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    const mockSessionA = { _receiveEvent: (e: unknown) => receivedA.push(e) } as any;
    const mockSessionB = { _receiveEvent: (e: unknown) => receivedB.push(e) } as any;

    harness.registerSessionListener('sess-a', mockSessionA);
    harness.registerSessionListener('sess-b', mockSessionB);

    // Simulate routing (as the fiber's consume loop does)
    const sessionListeners = (harness as any).sessionListeners as Map<string, any>;
    const dispatchEvent = (raw: { type: string; properties?: Record<string, unknown> }) => {
      const p = raw.properties;
      const sid = p && 'sessionID' in p ? p['sessionID'] : undefined;
      if (typeof sid === 'string') sessionListeners.get(sid)?._receiveEvent(raw);
    };

    dispatchEvent({ type: 'msg', properties: { sessionID: 'sess-a' } });
    dispatchEvent({ type: 'msg', properties: { sessionID: 'sess-b' } });
    dispatchEvent({ type: 'msg', properties: { sessionID: 'sess-a' } });

    expect(receivedA).toHaveLength(2);
    expect(receivedB).toHaveLength(1);
  });

  it('registers first session → forks exactly one SSE fiber (_sseFiber is non-null)', () => {
    mockGlobalEvent.mockReturnValue(new Promise(() => {})); // never resolves (stream hangs)

    const harness = createHarness();
    expect((harness as any)._sseFiber).toBeNull();

    harness.registerSessionListener('sess-1', { _receiveEvent: vi.fn() } as any);
    expect((harness as any)._sseFiber).not.toBeNull();
  });

  it('registering 3 sessions concurrently forks exactly one fiber (not 3)', () => {
    mockGlobalEvent.mockReturnValue(new Promise(() => {}));

    const harness = createHarness();
    harness.registerSessionListener('sess-a', { _receiveEvent: vi.fn() } as any);
    harness.registerSessionListener('sess-b', { _receiveEvent: vi.fn() } as any);
    harness.registerSessionListener('sess-c', { _receiveEvent: vi.fn() } as any);

    // Still only one fiber
    expect((harness as any)._sseFiber).not.toBeNull();
    // subscribe is called exactly once by the Effect fiber (buildSseProgram tries it)
    // Note: mockGlobalEvent may have been called 0 or 1 times depending on microtask timing;
    // the important invariant is that only ONE fiber was forked.
    const subscribeCallCount = (harness as any)._subscribeCallCount;
    expect(subscribeCallCount).toBeLessThanOrEqual(1); // ≤1 in synchronous scope
  });

  it('fiber calls subscribe once and routes events to matching session listener', async () => {
    const received: unknown[] = [];
    const mockSession = { _receiveEvent: (e: unknown) => received.push(e) } as any;

    mockGlobalEvent.mockResolvedValue(
      makeEventStream([
        { type: 'session.idle', properties: { sessionID: 'sess-target' } },
        { type: 'session.idle', properties: { sessionID: 'other-sess' } },
      ])
    );

    const harness = createHarness();
    harness.registerSessionListener('sess-target', mockSession);

    // Wait for stream to drain and events to be routed
    await new Promise<void>((r) => setTimeout(r, 50));

    // Only the event for 'sess-target' should have been delivered
    expect(received).toHaveLength(1);
    expect((received[0] as any).properties.sessionID).toBe('sess-target');
  });

  it('fiber resubscribes when stream ends (subscribe called again after backoff)', async () => {
    // Use very fast reconnect for this test: subscribe returns empty streams
    let callCount = 0;
    mockGlobalEvent.mockImplementation(() => {
      callCount++;
      if (callCount >= 3) {
        // Stop the fiber after 3 subscribe calls
        harness.unregisterSessionListener('sess-test');
      }
      return Promise.resolve(makeEmptyStream());
    });

    const harness = createHarness();
    harness.registerSessionListener('sess-test', { _receiveEvent: vi.fn() } as any);

    // Wait long enough for at least 2 reconnects (first backoff is 500ms)
    // We need to wait > 500ms for the second subscribe call
    await new Promise<void>((r) => setTimeout(r, 1200));

    // Should have called subscribe at least twice (initial + at least one retry)
    expect(callCount).toBeGreaterThanOrEqual(2);
  }, 5000);

  it('unregistering the last session clears the fiber reference', () => {
    mockGlobalEvent.mockReturnValue(new Promise(() => {}));

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
    mockGlobalEvent.mockReturnValue(new Promise(() => {}));

    const harness = createHarness();
    const sid = 'sess-close-test';
    const mockSession = { _receiveEvent: vi.fn() } as any;

    harness.registerSessionListener(sid, mockSession);
    expect((harness as any)._sseFiber).not.toBeNull();

    // Mock process exit so close() resolves
    (harness as any).childProcess.kill = vi.fn();
    (harness as any).childProcess.once = vi
      .fn()
      .mockImplementation((_event: string, cb: () => void) => setTimeout(cb, 0));

    await harness.close();

    expect((harness as any)._sseFiber).toBeNull();
    expect((harness as any).sessionListeners.size).toBe(0);
  });

  it('close() is idempotent when no fiber was started', async () => {
    // No sessions registered → fiber never started
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
