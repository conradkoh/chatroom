import { describe, expect, it } from 'vitest';

import { resolveFileTreeHydrationMode } from './resolve-hydration';
import type { FileTreeCheckpointView, FileTreeManifestView } from './resolve-hydration';

describe('resolveFileTreeHydrationMode', () => {
  it.each([
    [{ snapshotKind: 'v3' }, { complete: true }, 'sharded'],
    [null, { complete: true }, 'sharded'],
    [{ snapshotKind: 'v2' }, null, 'blob'],
    [null, null, 'blob'],
    [undefined, { complete: false }, 'pending'],
    [undefined, undefined, 'none'],
  ])('resolves %s/%s to %s', (checkpoint, manifest, expected) => {
    expect(
      resolveFileTreeHydrationMode({
        checkpoint: checkpoint as FileTreeCheckpointView | undefined,
        manifest: manifest as FileTreeManifestView | undefined,
      })
    ).toBe(expected);
  });
});
