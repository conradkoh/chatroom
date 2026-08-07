import { describe, expect, it, vi } from 'vitest';

import { createHarnessFingerprintPublisher } from './harness-fingerprint.js';

describe('createHarnessFingerprintPublisher', () => {
  it('calls refreshCapabilities with harness metadata and empty models', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createHarnessFingerprintPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'harness.fingerprint.updated',
      fingerprint: 'fp-1',
      availableHarnesses: ['cursor-sdk'],
      harnessVersions: { 'cursor-sdk': '2.0' },
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      availableHarnesses: ['cursor-sdk'],
      harnessVersions: { 'cursor-sdk': '2.0' },
      availableModels: {},
    });
  });
});
