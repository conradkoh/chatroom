import { describe, it, expect, vi } from 'vitest';

import { ConvexAgenticQueryRunRepository } from './convex-agentic-query-run-repository.js';

function createBackend() {
  return { mutation: vi.fn(), query: vi.fn() };
}

function createRepo(backend?: ReturnType<typeof createBackend>) {
  const b = backend ?? createBackend();
  return {
    repo: new ConvexAgenticQueryRunRepository({ backend: b, sessionId: 'mock-session-id' }),
    backend: b,
  };
}

describe('ConvexAgenticQueryRunRepository', () => {
  it('associateOpenCodeSessionId calls mutation with runId', async () => {
    const { repo, backend } = createRepo();

    await repo.associateOpenCodeSessionId('run-1', 'sess-abc', 'title');

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        runId: 'run-1',
        opencodeSessionId: 'sess-abc',
        sessionTitle: 'title',
      })
    );
  });

  it('getOpenCodeSessionId returns opencodeSessionId from query', async () => {
    const { repo, backend } = createRepo();
    backend.query.mockResolvedValue({ opencode: { opencodeSessionId: 'sess-abc' } });

    const result = await repo.getOpenCodeSessionId('run-1');

    expect(backend.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', runId: 'run-1' })
    );
    expect(result).toBe('sess-abc');
  });

  it('getOpenCodeSessionId returns undefined when not found', async () => {
    const { repo, backend } = createRepo();
    backend.query.mockResolvedValue(null);

    expect(await repo.getOpenCodeSessionId('run-missing')).toBeUndefined();
  });

  it('markClosed calls closeRun mutation', async () => {
    const { repo, backend } = createRepo();

    await repo.markClosed('run-1');

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', runId: 'run-1' })
    );
  });

  it('markIdle calls markIdle mutation', async () => {
    const { repo, backend } = createRepo();
    await repo.markIdle('run-1');
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', runId: 'run-1' })
    );
  });

  it('markFailed calls markFailed mutation', async () => {
    const { repo, backend } = createRepo();
    await repo.markFailed('run-1');
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', runId: 'run-1' })
    );
  });

  it('markActive calls markActive mutation', async () => {
    const { repo, backend } = createRepo();
    await repo.markActive('run-1');
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', runId: 'run-1' })
    );
  });

  it('markTurnProcessed calls turns.markTurnProcessed mutation', async () => {
    const { repo, backend } = createRepo();
    await repo.markTurnProcessed('run-1', 42);
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', runId: 'run-1', turnSeq: 42 })
    );
  });

  it('setGenerating calls queue.setGenerating mutation', async () => {
    const { repo, backend } = createRepo();
    await repo.setGenerating('run-1', true);
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', runId: 'run-1', isGenerating: true })
    );
  });

  it('beginAssistantTurn calls turns.beginAssistantTurn mutation', async () => {
    const { repo, backend } = createRepo();
    backend.mutation.mockResolvedValue({ turnId: 'turn-1', turnSeq: 1 });
    const result = await repo.beginAssistantTurn('run-1');
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', runId: 'run-1' })
    );
    expect(result).toEqual({ turnId: 'turn-1', turnSeq: 1 });
  });

  it('bindTurnMessageId calls turns.bindTurnMessageId mutation', async () => {
    const { repo, backend } = createRepo();
    await repo.bindTurnMessageId('turn-1', 'msg-1');
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        turnId: 'turn-1',
        messageId: 'msg-1',
      })
    );
  });

  it('finalizeAssistantTurn calls turns.finalizeAssistantTurn mutation', async () => {
    const { repo, backend } = createRepo();
    await repo.finalizeAssistantTurn('turn-1');
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'mock-session-id', turnId: 'turn-1' })
    );
  });

  it('updateSessionTitle is no-op', async () => {
    const { repo, backend } = createRepo();
    await repo.updateSessionTitle('run-1', 'title');
    expect(backend.mutation).not.toHaveBeenCalled();
  });
});
