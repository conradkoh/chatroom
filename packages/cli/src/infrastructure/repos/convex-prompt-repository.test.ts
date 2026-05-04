import { describe, it, expect, vi } from 'vitest';

import { ConvexPromptRepository } from './convex-prompt-repository.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createBackend() {
  return { mutation: vi.fn() };
}

function createRepo(backend?: ReturnType<typeof createBackend>, machineId?: string) {
  const b = backend ?? createBackend();
  return {
    repo: new ConvexPromptRepository({
      backend: b,
      sessionId: 'mock-session-id',
      machineId: machineId ?? 'machine-1',
    }),
    backend: b,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConvexPromptRepository', () => {
  it('complete with status done calls completePendingPrompt', async () => {
    const { repo, backend } = createRepo();

    await repo.complete('prompt-1', 'done');

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        machineId: 'machine-1',
        promptId: 'prompt-1',
        status: 'done',
      })
    );
  });

  it('complete with status error includes errorMessage', async () => {
    const { repo, backend } = createRepo();

    await repo.complete('prompt-1', 'error', 'Something went wrong');

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'mock-session-id',
        machineId: 'machine-1',
        promptId: 'prompt-1',
        status: 'error',
        errorMessage: 'Something went wrong',
      })
    );
  });

  it('passes the configured machineId', async () => {
    const { repo, backend } = createRepo(undefined, 'custom-machine');

    await repo.complete('prompt-1', 'done');

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ machineId: 'custom-machine' })
    );
  });

  it('omits errorMessage when not provided', async () => {
    const { repo, backend } = createRepo();

    await repo.complete('prompt-2', 'done');

    const args = backend.mutation.mock.calls[0][1];
    expect(args).not.toHaveProperty('errorMessage');
  });
});
