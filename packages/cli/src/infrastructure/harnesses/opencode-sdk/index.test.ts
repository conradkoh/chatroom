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
import { InMemorySessionMetadataStore } from '../../services/remote-agents/opencode-sdk/session-metadata-store.js';

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

function createHarness(sessionStoreOverride?: InMemorySessionMetadataStore) {
  const spawnFn = vi.fn();
  const sessionStore = sessionStoreOverride ?? new InMemorySessionMetadataStore();
  const harness = createOpencodeSdkHarness({
    spawnFn,
    startupTimeoutMs: 1000,
    nowFn: () => 0,
    sessionStore,
  });
  return { harness, spawnFn, sessionStore };
}

const VALID_CONFIG = { chatroomId: 'room-1', role: 'builder', machineId: 'machine-1' };

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

  it('openSession() returns a session with the harness-issued harnessSessionId', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue(createFakeChild(1234));

    const session = await harness.openSession({ cwd: '/tmp', config: VALID_CONFIG });

    expect(session.harnessSessionId).toBe('sdk-session-test' as HarnessSessionId);
  });

  it('openSession() propagates errors when process fails to start (no pid)', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue({ pid: undefined, kill: vi.fn(), stdout: new EventEmitter(), stderr: new EventEmitter() });

    await expect(harness.openSession({ cwd: '/tmp', config: VALID_CONFIG })).rejects.toThrow('Failed to spawn');
  });

  it('openSession() propagates session.create failures', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue(createFakeChild(2345));
    mockCreateSessionFn.mockRejectedValue(new Error('session create failed'));

    await expect(harness.openSession({ cwd: '/tmp', config: VALID_CONFIG })).rejects.toThrow('session create failed');
  });

  it('openSession() throws when chatroomId is missing from config', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue(createFakeChild(3456));

    await expect(harness.openSession({ cwd: '/tmp', config: { role: 'builder', machineId: 'machine-1' } }))
      .rejects.toThrow('chatroomId');
  });

  it('openSession() throws when role is missing from config', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue(createFakeChild(3457));

    await expect(harness.openSession({ cwd: '/tmp', config: { chatroomId: 'room-1', machineId: 'machine-1' } }))
      .rejects.toThrow('role');
  });

  it('openSession() throws when machineId is missing from config', async () => {
    const { harness, spawnFn } = createHarness();
    spawnFn.mockReturnValue(createFakeChild(3458));

    await expect(harness.openSession({ cwd: '/tmp', config: { chatroomId: 'room-1', role: 'builder' } }))
      .rejects.toThrow('machineId');
  });

  it('openSession() persists session metadata to the store', async () => {
    const sessionStore = new InMemorySessionMetadataStore();
    const { harness, spawnFn } = createHarness(sessionStore);
    spawnFn.mockReturnValue(createFakeChild(4567));

    await harness.openSession({ cwd: '/tmp', config: VALID_CONFIG });

    const stored = sessionStore.get('sdk-session-test');
    expect(stored).toBeDefined();
    expect(stored?.baseUrl).toBe('http://localhost:12345');
    expect(stored?.chatroomId).toBe('room-1');
    expect(stored?.role).toBe('builder');
    expect(stored?.machineId).toBe('machine-1');
  });

  it('resumeSession() throws when harnessSessionId is not in the store', async () => {
    const { harness } = createHarness();
    const unknownId = 'nonexistent-session' as HarnessSessionId;

    await expect(harness.resumeSession(unknownId)).rejects.toThrow('not found in session store');
  });

  it('resumeSession() returns a working session after a successful openSession()', async () => {
    const sessionStore = new InMemorySessionMetadataStore();
    const { harness, spawnFn } = createHarness(sessionStore);
    spawnFn.mockReturnValue(createFakeChild(5678));

    const opened = await harness.openSession({ cwd: '/tmp', config: VALID_CONFIG });
    const resumed = await harness.resumeSession(opened.harnessSessionId);

    expect(resumed.harnessSessionId).toBe(opened.harnessSessionId);
  });

  it('close() on opened session removes the store entry', async () => {
    const sessionStore = new InMemorySessionMetadataStore();
    const { harness, spawnFn } = createHarness(sessionStore);
    spawnFn.mockReturnValue(createFakeChild(6789));

    const session = await harness.openSession({ cwd: '/tmp', config: VALID_CONFIG });
    expect(sessionStore.get('sdk-session-test')).toBeDefined();

    await session.close();

    expect(sessionStore.get('sdk-session-test')).toBeUndefined();
  });

  it('close() on resumed session does NOT remove the store entry', async () => {
    const sessionStore = new InMemorySessionMetadataStore();
    const { harness, spawnFn } = createHarness(sessionStore);
    spawnFn.mockReturnValue(createFakeChild(7890));

    const opened = await harness.openSession({ cwd: '/tmp', config: VALID_CONFIG });
    const resumed = await harness.resumeSession(opened.harnessSessionId);

    await resumed.close();

    // Store entry still present — the spawner still owns it
    expect(sessionStore.get('sdk-session-test')).toBeDefined();
  });
});
