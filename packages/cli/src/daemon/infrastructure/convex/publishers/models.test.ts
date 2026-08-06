import { describe, expect, it, vi } from 'vitest';

import { createModelsPublisher } from './models.js';

describe('createModelsPublisher', () => {
  it('calls refreshCapabilities with model snapshot fields', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createModelsPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'models.updated',
      availableModels: { 'opencode-sdk': ['gpt-4'] },
      availableHarnesses: ['opencode-sdk'],
      harnessVersions: { 'opencode-sdk': '1.0' },
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      availableModels: { 'opencode-sdk': ['gpt-4'] },
      availableHarnesses: ['opencode-sdk'],
      harnessVersions: { 'opencode-sdk': '1.0' },
    });
  });
});
