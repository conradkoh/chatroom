import { describe, it, expect, vi } from 'vitest';

import { ConvexAgenticQueryOutputRepository } from './convex-agentic-query-output-repository.js';

describe('ConvexAgenticQueryOutputRepository', () => {
  it('skips empty chunks array (no mutation)', async () => {
    const backend = { mutation: vi.fn() };
    const repo = new ConvexAgenticQueryOutputRepository({ backend, sessionId: 'mock-session-id' });

    await repo.appendChunks('run-1', []);

    expect(backend.mutation).not.toHaveBeenCalled();
  });

  it('appendChunks calls appendMessages with mapped chunks', async () => {
    const backend = { mutation: vi.fn() };
    const repo = new ConvexAgenticQueryOutputRepository({ backend, sessionId: 'mock-session-id' });

    await repo.appendChunks('run-1', [
      { content: 'hello', timestamp: 1000, messageId: 'msg-1', partType: 'text' },
      { content: ' world', timestamp: 1001, messageId: 'msg-1', partType: 'text' },
    ]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        runId: 'run-1',
        chunks: expect.arrayContaining([
          expect.objectContaining({
            content: 'hello',
            timestamp: 1000,
            messageId: 'msg-1',
            partType: 'text',
          }),
          expect.objectContaining({
            content: ' world',
            timestamp: 1001,
            messageId: 'msg-1',
            partType: 'text',
          }),
        ]),
      })
    );
  });
});
