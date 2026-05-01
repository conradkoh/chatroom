import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockCreateSessionFn = vi.fn();
const mockPromptAsyncFn = vi.fn().mockResolvedValue(undefined);
const mockAbortFn = vi.fn().mockResolvedValue(undefined);
const mockSubscribeFn = vi.fn().mockResolvedValue({
  stream: (async function* () {})(),
});

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(() => ({
    session: {
      create: mockCreateSessionFn,
      promptAsync: mockPromptAsyncFn,
      abort: mockAbortFn,
    },
    event: {
      subscribe: mockSubscribeFn,
    },
  })),
}));

vi.mock('../../services/remote-agents/opencode-sdk/parse-listening-url.js', () => ({
  waitForListeningUrl: vi.fn().mockResolvedValue('http://localhost:12345'),
}));

import { createOpencodeSdkHarness } from './index.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createFakeChild(pid = 9999) {
  const emitter = new EventEmitter();
  return {
    pid,
    kill: vi.fn(),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
}

function createHarness() {
  const spawnFn = vi.fn();
  const harness = createOpencodeSdkHarness({ spawnFn, startupTimeoutMs: 1000, nowFn: () => 0 });
  return { harness, spawnFn };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createOpencodeSdkHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSessionFn.mockResolvedValue({ data: { id: 'sdk-session-test' } });
    mockSubscribeFn.mockResolvedValue({ stream: (async function* () {})() });
  });

  it('harnessName equals "opencode-sdk"', () => {
    const { harness } = createHarness();
    expect(harness.harnessName).toBe('opencode-sdk');
  });

  it('spawn() returns a session with the harness-issued harnessSessionId', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue(createFakeChild(1234));

    const session = await harness.spawn({ cwd: '/tmp' });

    expect(session.harnessSessionId).toBe('sdk-session-test' as HarnessSessionId);
  });

  it('spawn() propagates errors from the underlying process startup', async () => {
    const { harness, spawnFn } = createHarness();
    // No pid → process failed to start
    spawnFn.mockReturnValue({ pid: undefined, kill: vi.fn(), stdout: new EventEmitter(), stderr: new EventEmitter() });

    await expect(harness.spawn({ cwd: '/tmp' })).rejects.toThrow('Failed to spawn');
  });

  it('spawn() propagates session.create failures', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue(createFakeChild(2345));
    mockCreateSessionFn.mockRejectedValue(new Error('session create failed'));

    await expect(harness.spawn({ cwd: '/tmp' })).rejects.toThrow('session create failed');
  });

  it('resume() throws when the harnessSessionId is not in the registry', async () => {
    const { harness } = createHarness();
    const unknownId = 'nonexistent-session' as HarnessSessionId;

    await expect(harness.resume(unknownId)).rejects.toThrow('not found in registry');
  });

  it('resume() returns a working session after a successful spawn', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue(createFakeChild(3456));

    const spawned = await harness.spawn({ cwd: '/tmp' });
    const resumed = await harness.resume(spawned.harnessSessionId);

    expect(resumed.harnessSessionId).toBe(spawned.harnessSessionId);
  });
});
