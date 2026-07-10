import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';
import { describe, expect, it } from 'vitest';

import {
  MAX_SHARD_JSON_BYTES,
  MAX_TREE_JSON_BYTES,
  computeShardDataHash,
  partitionFileTree,
  shouldUseV3Upload,
  type FileTreeShardPayload,
} from './file-tree-partition.js';

const baseTree: FileTree = {
  entries: [
    { path: 'package.json', type: 'file' },
    { path: 'src', type: 'directory' },
    { path: 'src/index.ts', type: 'file' },
    { path: 'packages', type: 'directory' },
    { path: 'packages/core/index.ts', type: 'file' },
  ],
  scannedAt: 1_700_000_000_000,
  rootDir: '/workspace',
};

function makeEntries(count: number, pathFn: (i: number) => string): FileTreeEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    path: pathFn(i),
    type: 'file' as const,
    size: 4096,
    modifiedAt: 1_700_000_000_000 + i,
  }));
}

function makeTreeWithJsonSize(targetBytes: number): FileTree {
  const estimatedCount = Math.ceil(targetBytes / 90) + 500;
  let entries = makeEntries(estimatedCount, (i) => `src/file-${i}.ts`);
  let tree: FileTree = {
    entries,
    scannedAt: 1_700_000_000_000,
    rootDir: '/workspace',
  };
  while (Buffer.byteLength(JSON.stringify(tree), 'utf8') <= targetBytes) {
    entries = makeEntries(entries.length + 1000, (i) => `src/file-${i}.ts`);
    tree = { entries, scannedAt: tree.scannedAt, rootDir: tree.rootDir };
  }
  return tree;
}

describe('shouldUseV3Upload', () => {
  it('returns false for small trees', () => {
    expect(shouldUseV3Upload(baseTree)).toBe(false);
  });

  it('returns true when tree JSON exceeds MAX_TREE_JSON_BYTES', () => {
    const largeTree = makeTreeWithJsonSize(MAX_TREE_JSON_BYTES + 1);
    expect(shouldUseV3Upload(largeTree)).toBe(true);
  });
});

describe('partitionFileTree', () => {
  it('groups root vs nested paths into __root__ and top-level shard ids', () => {
    const shards = partitionFileTree(baseTree);
    const shardIds = shards.map((s) => s.shardId).sort();

    expect(shardIds).toEqual(['__root__', 'packages', 'src']);
    expect(shards.find((s) => s.shardId === '__root__')?.entryCount).toBe(3);
    expect(shards.find((s) => s.shardId === 'src')?.entryCount).toBe(1);
    expect(shards.find((s) => s.shardId === 'packages')?.entryCount).toBe(1);
  });

  it('subdivides oversized shards by next path segment', () => {
    const unique = 'segment'.repeat(80);
    const makeGroup = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        path: `${prefix}/${unique}-${i}/file.ts`,
        type: 'file' as const,
        size: 16384,
        modifiedAt: 1_700_000_000_000 + i,
      }));
    const tree: FileTree = {
      entries: [...makeGroup('src/components', 41_500), ...makeGroup('src/lib', 41_500)],
      scannedAt: 1_700_000_000_000,
      rootDir: '/workspace',
    };

    const shards = partitionFileTree(tree);
    const shardIds = shards.map((s) => s.shardId);

    expect(shardIds).toContain('src/components');
    expect(shardIds).toContain('src/lib');
    expect(shardIds).not.toContain('src');
  });

  it('keeps each shard gzip base64 content within MAX_SHARD_JSON_BYTES', () => {
    const targetBytes = MAX_TREE_JSON_BYTES + 50_000;
    const estimatedCount = Math.ceil(targetBytes / 90) + 500;
    let entries = Array.from({ length: estimatedCount }, (_, i) => ({
      path: `dir-${i % 40}/file-${i}.ts`,
      type: 'file' as const,
      size: 4096,
      modifiedAt: 1_700_000_000_000 + i,
    }));
    let tree: FileTree = {
      entries,
      scannedAt: 1_700_000_000_000,
      rootDir: '/workspace',
    };
    while (Buffer.byteLength(JSON.stringify(tree), 'utf8') <= targetBytes) {
      entries = Array.from({ length: entries.length + 1000 }, (_, i) => ({
        path: `dir-${i % 40}/file-${i}.ts`,
        type: 'file' as const,
        size: 4096,
        modifiedAt: 1_700_000_000_000 + i,
      }));
      tree = { entries, scannedAt: tree.scannedAt, rootDir: tree.rootDir };
    }

    const shards = partitionFileTree(tree);

    expect(shards.length).toBeGreaterThan(1);
    for (const shard of shards) {
      expect(Buffer.byteLength(shard.data.content, 'utf8')).toBeLessThanOrEqual(
        MAX_SHARD_JSON_BYTES
      );
    }
    expect(new Set(shards.map((s) => s.shardId)).size).toBe(shards.length);
  });
});

describe('computeShardDataHash', () => {
  it('returns stable hash for the same payload', () => {
    const payload: FileTreeShardPayload = {
      entries: [{ path: 'a.ts', type: 'file' }],
      scannedAt: 1,
      rootDir: '/workspace',
    };
    expect(computeShardDataHash(payload)).toBe(computeShardDataHash(payload));
  });
});
