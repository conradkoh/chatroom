import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

import { OpencodeSdkHarness, startOpencodeSdkHarness } from './opencode-harness.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/entities/harness-session.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockGet = vi.fn();
const mockAbort = vi.fn();
const mockPrompt = vi.fn();
const mockProviderList = vi.fn();
const mockSubscribe = vi.fn();

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
    event: {
      subscribe: mockSubscribe,
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

vi.mock('../../../infrastructure/services/remote-agents/opencode-sdk/parse-listening-url.js', () => ({
  waitForListeningUrl: vi.fn(() => Promise.resolve('http://127.0.0.1:15432')),
}));

import { spawn } from 'node:child_process';
import { waitForListeningUrl } from '../../../infrastructure/services/remote-agents/opencode-sdk/parse-listening-url.js';

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
  cwd?: string;
  client?: Record<string, unknown>;
  process?: MockProcess & EventEmitter;
}) {
  const proc = overrides?.process ?? makeProcess();
  return new OpencodeSdkHarness({
    cwd: overrides?.cwd ?? '/test/workspace',
    client: (overrides?.client ?? {
      session: { create: mockCreate, get: mockGet, abort: mockAbort, prompt: mockPrompt },
      provider: { list: mockProviderList },
      event: { subscribe: mockSubscribe },
    }) as unknown as import('@opencode-ai/sdk').OpencodeClient,
    process: proc as unknown as import('node:child_process').ChildProcess,
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
          { name: 'Anthropic', id: 'anthropic', models: { 'claude-3': { id: 'claude-3', name: 'Claude 3' } } },
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
      { id: 'claude-3', name: 'Claude 3', provider: 'Anthropic' },
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

    expect(session.harnessSessionId).toBe('sess-456');
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

    expect(session.harnessSessionId).toBe('sess-789');
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
    const session = await harness.resumeSession('sess-existing' as HarnessSessionId);

    expect(mockGet).toHaveBeenCalledWith({ path: { id: 'sess-existing' } });
    expect(session.harnessSessionId).toBe('sess-existing');
    expect(session.sessionTitle).toBe('Existing Session');
  });

  it('throws when resumed session does not exist', async () => {
    mockGet.mockRejectedValue(new Error('not found'));

    const harness = createHarness();
    await expect(harness.resumeSession('sess-gone' as HarnessSessionId)).rejects.toThrow(
      'Session sess-gone not found on the harness'
    );
  });

  it('throws when resuming session on closed harness', async () => {
    const harness = createHarness();
    await harness.close();
    await expect(harness.resumeSession('sess-any' as HarnessSessionId)).rejects.toThrow(
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
      type: 'opencode',
      workingDir: '/test/ws',
      workspaceId: 'ws-1',
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

    await expect(startOpencodeSdkHarness({
      type: 'opencode',
      workingDir: '/test/ws',
      workspaceId: 'ws-1',
    })).rejects.toThrow('timeout');

    // The process should have been killed
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  // ── properties ──────────────────────────────────────────────────────────────

  it('exposes type', () => {
    const harness = createHarness();
    expect(harness.type).toBe('opencode-sdk');
  });
});
