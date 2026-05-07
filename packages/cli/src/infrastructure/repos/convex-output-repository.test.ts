import { describe, it, expect, vi } from 'vitest';

import { ConvexOutputRepository } from './convex-output-repository.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createBackend() {
  return { mutation: vi.fn() };
}

function createRepo(backend?: ReturnType<typeof createBackend>) {
  const b = backend ?? createBackend();
  return {
    repo: new ConvexOutputRepository({ backend: b, sessionId: 'mock-session-id' }),
    backend: b,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConvexOutputRepository', () => {
  it('appendChunks calls messages.appendMessages with mapped chunks', async () => {
    const { repo, backend } = createRepo();

    await repo.appendChunks('row-1', [
      { content: 'hello', timestamp: 100, messageId: 'msg-1', partType: 'text' },
      { content: 'world', timestamp: 200, messageId: 'msg-1', partType: 'text' },
    ]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        harnessSessionId: 'row-1',
        chunks: [
          { content: 'hello', timestamp: 100, messageId: 'msg-1', partType: 'text' },
          { content: 'world', timestamp: 200, messageId: 'msg-1', partType: 'text' },
        ],
      })
    );
  });

  it('forwards chunks without messageId/partType as-is (legacy path)', async () => {
    const { repo, backend } = createRepo();

    await repo.appendChunks('row-1', [
      { content: 'legacy', timestamp: 100 },
    ]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chunks: [
          { content: 'legacy', timestamp: 100, messageId: undefined, partType: undefined },
        ],
      })
    );
  });

  it('appendChunks skips empty chunk arrays', async () => {
    const { repo, backend } = createRepo();

    await repo.appendChunks('row-1', []);

    expect(backend.mutation).not.toHaveBeenCalled();
  });

});
