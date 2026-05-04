import { describe, it, expect, vi } from 'vitest';

import { ConvexSessionRepository } from './convex-session-repository.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createBackend() {
  return {
    mutation: vi.fn(),
    query: vi.fn(),
  };
}

function createRepo(backend?: ReturnType<typeof createBackend>) {
  const b = backend ?? createBackend();
  return {
    repo: new ConvexSessionRepository({ backend: b, sessionId: 'mock-session-id' }),
    backend: b,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConvexSessionRepository', () => {
  it('createSession calls sessions.openSession mutation', async () => {
    const { repo, backend } = createRepo();
    backend.mutation.mockResolvedValue({ harnessSessionRowId: 'row-1' });

    const result = await repo.createSession('ws-1', 'opencode-sdk', { agent: 'builder' });

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        workspaceId: 'ws-1',
        harnessName: 'opencode-sdk',
        config: { agent: 'builder' },
      })
    );
    expect(result).toEqual({ harnessSessionRowId: 'row-1' });
  });

  it('associateHarnessSessionId calls openSession mutation with title', async () => {
    const { repo, backend } = createRepo();

    await repo.associateHarnessSessionId('row-1', 'sess-abc', 'My Session');

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        harnessSessionRowId: 'row-1',
        harnessSessionId: 'sess-abc',
        sessionTitle: 'My Session',
      })
    );
  });

  it('getHarnessSessionId returns the harness session ID from the query', async () => {
    const { repo, backend } = createRepo();
    backend.query.mockResolvedValue({ harnessSessionId: 'sess-abc' });

    const result = await repo.getHarnessSessionId('row-1');

    expect(backend.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ harnessSessionRowId: 'row-1' })
    );
    expect(result).toBe('sess-abc');
  });

  it('getHarnessSessionId returns undefined when session not found', async () => {
    const { repo, backend } = createRepo();
    backend.query.mockResolvedValue(null);

    const result = await repo.getHarnessSessionId('row-missing');

    expect(result).toBeUndefined();
  });

  it('markClosed calls sessions.closeSession mutation', async () => {
    const { repo, backend } = createRepo();

    await repo.markClosed('row-1');

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        harnessSessionRowId: 'row-1',
      })
    );
  });
});
