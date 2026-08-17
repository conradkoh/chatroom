import { describe, expect, it } from 'vitest';

import { fromLegacyCheckpoint, toLegacyCheckpointPublishArgs } from './checkpoint';

describe('checkpoint adapters', () => {
  it.each([
    ['v2', 'blob'],
    ['v3', 'sharded'],
  ])('maps %s', (kind, strategyId) => {
    const value = fromLegacyCheckpoint({
      revision: 1,
      snapshotKind: kind as 'v2' | 'v3',
      snapshotId: 'id',
      publishedAt: 1,
    });
    expect(value.strategyId).toBe(strategyId);
    expect(toLegacyCheckpointPublishArgs(value).snapshotKind).toBe(kind);
  });
});
