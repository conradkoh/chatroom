import { describe, expect, it } from 'vitest';

import {
  isFileTreeHydrationLoading,
  resolveFileTreeHydrationPlan,
  type BlobHydrationStatus,
  type ShardedHydrationStatus,
  type ShardedSnapshotManifestView,
} from './resolve-hydration-plan';
import type { FileTreeCheckpointTransport } from './transport/checkpoint';

describe('resolveFileTreeHydrationPlan', () => {
  it.each([
    [undefined, undefined, 'skip', 'skip', 'awaiting-queries'],
    [{ strategyId: 'blob' }, undefined, 'skip', 'skip', 'awaiting-queries'],
  ] as const)(
    'waits for checkpoint/manifest queries (%s/%s)',
    (checkpoint, manifest, blobStatus, shardedStatus, expectedKind) => {
      const plan = resolveFileTreeHydrationPlan({
        checkpoint: checkpoint as FileTreeCheckpointTransport | undefined,
        manifest: manifest as ShardedSnapshotManifestView | undefined,
        blobStatus: blobStatus as BlobHydrationStatus,
        shardedStatus: shardedStatus as ShardedHydrationStatus,
      });
      expect(plan.kind).toBe(expectedKind);
      expect(isFileTreeHydrationLoading(plan)).toBe(true);
    }
  );

  it('recovers on incomplete manifest (goals deadlock scenario)', () => {
    const plan = resolveFileTreeHydrationPlan({
      checkpoint: {
        revision: 5,
        strategyId: 'sharded',
        snapshotId: 'gen-partial',
        publishedAt: 1,
      },
      manifest: {
        syncGeneration: 'gen-partial',
        complete: false,
      },
      blobStatus: 'skip',
      shardedStatus: 'skip',
    });
    expect(plan).toEqual({
      kind: 'recover',
      reason: 'incomplete-manifest',
      recoveryKey: 'gen-partial',
    });
    expect(isFileTreeHydrationLoading(plan)).toBe(false);
  });

  it('hydrates blob when checkpoint is blob', () => {
    const plan = resolveFileTreeHydrationPlan({
      checkpoint: { revision: 1, strategyId: 'blob', snapshotId: 'h', publishedAt: 1 },
      manifest: null,
      blobStatus: 'queries-pending',
      shardedStatus: 'skip',
    });
    expect(plan).toEqual({ kind: 'hydrate-blob', loading: true });
  });

  it('hydrates sharded when manifest complete', () => {
    const plan = resolveFileTreeHydrationPlan({
      checkpoint: null,
      manifest: { syncGeneration: 'gen-1', complete: true },
      blobStatus: 'skip',
      shardedStatus: 'decompressing',
    });
    expect(plan).toEqual({ kind: 'hydrate-sharded', syncGeneration: 'gen-1', loading: true });
  });

  it('recovers when shard decompression fails', () => {
    const plan = resolveFileTreeHydrationPlan({
      checkpoint: null,
      manifest: { syncGeneration: 'gen-1', complete: true },
      blobStatus: 'skip',
      shardedStatus: 'decompression-failed',
      shardsPayloadKey: 'a:1|b:2',
    });
    expect(plan).toEqual({
      kind: 'recover',
      reason: 'shard-decompression-failed',
      recoveryKey: 'gen-1:a:1|b:2',
    });
    expect(isFileTreeHydrationLoading(plan)).toBe(false);
  });

  it('never reports loading for recover or idle settled states', () => {
    const recover = resolveFileTreeHydrationPlan({
      checkpoint: { revision: 1, strategyId: 'sharded', snapshotId: 'g', publishedAt: 1 },
      manifest: { syncGeneration: 'g', complete: false },
      blobStatus: 'skip',
      shardedStatus: 'skip',
    });
    const idle = resolveFileTreeHydrationPlan({
      checkpoint: null,
      manifest: null,
      blobStatus: 'skip',
      shardedStatus: 'skip',
    });
    expect(isFileTreeHydrationLoading(recover)).toBe(false);
    expect(isFileTreeHydrationLoading(idle)).toBe(false);
  });
});
