import { describe, expect, it } from 'vitest';

import { snapshotKindToStrategyId, strategyIdToSnapshotKind } from '../types';

describe('snapshot kind mappers (migration)', () => {
  it.each([
    ['v2', 'blob'],
    ['v3', 'sharded'],
  ] as const)('maps %s to %s and back', (kind, strategyId) => {
    expect(snapshotKindToStrategyId(kind)).toBe(strategyId);
    expect(strategyIdToSnapshotKind(strategyId)).toBe(kind);
  });
});
