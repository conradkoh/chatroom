import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockSubscribeFn = vi.fn().mockResolvedValue({
  stream: (async function* () {})(),
});

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(() => ({
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: 'sdk-session-test' } }),
      promptAsync: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    },
    event: {
      subscribe: mockSubscribeFn,
    },
    app: {
      agents: vi.fn().mockResolvedValue({ data: [] }),
    },
  })),
}));

vi.mock('../../services/remote-agents/opencode-sdk/parse-listening-url.js', () => ({
  waitForListeningUrl: vi.fn().mockResolvedValue('http://localhost:12345'),
}));

import { createOpencodeSdkResumer, resumeSessionFromStore } from './index.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/index.js';
import { InMemorySessionMetadataStore } from '../../services/remote-agents/opencode-sdk/session-metadata-store.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createResumer(sessionStoreOverride?: InMemorySessionMetadataStore) {
  const sessionStore = sessionStoreOverride ?? new InMemorySessionMetadataStore();
  const resumer = createOpencodeSdkResumer({
    nowFn: () => 0,
    sessionStore,
  });
  return { resumer, sessionStore };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createOpencodeSdkResumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeFn.mockResolvedValue({ stream: (async function* () {})() });
  });

  it('harnessName equals "opencode-sdk"', () => {
    const { resumer } = createResumer();
    expect(resumer.harnessName).toBe('opencode-sdk');
  });

  it('openSession() throws — resumer cannot open new sessions', async () => {
    const { resumer } = createResumer();
    await expect(resumer.openSession({ cwd: '/tmp' })).rejects.toThrow(
      'createOpencodeSdkResumer cannot open new sessions'
    );
  });

  it('resumeSession() returns a session for a known store entry', async () => {
    const sessionStore = new InMemorySessionMetadataStore();
    sessionStore.upsert({
      sessionId: 'known-session-1',
      machineId: 'm1',
      chatroomId: 'c1',
      role: 'builder',
      pid: 1234,
      createdAt: new Date(0).toISOString(),
      baseUrl: 'http://localhost:12345',
    });

    const { resumer } = createResumer(sessionStore);
    const session = await resumer.resumeSession('known-session-1' as HarnessSessionId);

    expect(session.harnessSessionId).toBe('known-session-1');
  });

  it('resumeSession() throws for an unknown harnessSessionId', async () => {
    const { resumer } = createResumer();
    await expect(resumer.resumeSession('nonexistent-session' as HarnessSessionId)).rejects.toThrow(
      'not found in session store'
    );
  });

  it('uses provided sessionStore for lookups', async () => {
    const sessionStore = new InMemorySessionMetadataStore();
    sessionStore.upsert({
      sessionId: 'stored-session',
      machineId: 'm1',
      chatroomId: 'c1',
      role: 'reviewer',
      pid: 5678,
      createdAt: new Date(0).toISOString(),
      baseUrl: 'http://localhost:9999',
    });

    const { resumer } = createResumer(sessionStore);
    const session = await resumer.resumeSession('stored-session' as HarnessSessionId);
    expect(session.harnessSessionId).toBe('stored-session');
  });
});

describe('resumeSessionFromStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeFn.mockResolvedValue({ stream: (async function* () {})() });
  });

  it('returns a session when the ID is found in the store', async () => {
    const sessionStore = new InMemorySessionMetadataStore();
    sessionStore.upsert({
      sessionId: 'test-resume-id',
      machineId: 'm1',
      chatroomId: 'c1',
      role: 'builder',
      pid: 9999,
      createdAt: new Date(0).toISOString(),
      baseUrl: 'http://localhost:12345',
    });

    const session = await resumeSessionFromStore(
      'test-resume-id' as HarnessSessionId,
      sessionStore,
      {},
      () => 0
    );

    expect(session.harnessSessionId).toBe('test-resume-id');
  });

  it('throws when the ID is not found in the store', async () => {
    const sessionStore = new InMemorySessionMetadataStore();

    await expect(
      resumeSessionFromStore('unknown-id' as HarnessSessionId, sessionStore, {}, () => 0)
    ).rejects.toThrow('not found in session store');
  });

  it('creates a new client when no reuseClient is provided', async () => {
    const sessionStore = new InMemorySessionMetadataStore();
    sessionStore.upsert({
      sessionId: 'fresh-client-id',
      machineId: 'm1',
      chatroomId: 'c1',
      role: 'builder',
      pid: 9999,
      createdAt: new Date(0).toISOString(),
      baseUrl: 'http://localhost:54321',
    });

    const session = await resumeSessionFromStore(
      'fresh-client-id' as HarnessSessionId,
      sessionStore,
      {}, // no reuseClient
      () => 0
    );

    expect(session.harnessSessionId).toBe('fresh-client-id');
  });
});