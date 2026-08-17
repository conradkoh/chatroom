import { describe, expect, it } from 'vitest';

import { resolveFileTreeHydrationMode } from './resolve-hydration';
import type { ShardedSnapshotManifestView } from './resolve-hydration';
import type { FileTreeCheckpointTransport } from './transport/checkpoint';

describe('resolveFileTreeHydrationMode', () => {
  it.each([
    [{ strategyId: 'sharded' }, { complete: true }, 'sharded'],
    [null, { complete: true }, 'sharded'],
    [{ strategyId: 'blob' }, null, 'blob'],
    [null, null, 'blob'],
    [undefined, { complete: false }, 'pending'],
    [undefined, undefined, 'none'],
  ])('resolves %s/%s to %s', (checkpoint, manifest, expected) => {
    expect(
      resolveFileTreeHydrationMode({
        checkpoint: checkpoint as FileTreeCheckpointTransport | undefined,
        manifest: manifest as ShardedSnapshotManifestView | undefined,
      })
    ).toBe(expected);
  });
});
