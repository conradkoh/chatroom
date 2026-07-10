import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_SHARD_BATCH_SIZE, MAX_TREE_JSON_BYTES } from './file-tree-partition.js';
import { uploadFileTreeV3 } from './file-tree-v3-upload.js';
import type { DaemonSessionServiceShape } from '../../../commands/machine/daemon-start/daemon-services.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      syncFileTreeShardV3Batch: 'mock-syncFileTreeShardV3Batch',
      syncFileTreeManifestV3: 'mock-syncFileTreeManifestV3',
    },
  },
}));

function makeEntry(shard: number, i: number): FileTreeEntry {
  return {
    path: `shard-${shard}/file-${i}.ts`,
    type: 'file',
    size: 4096,
    modifiedAt: 1_700_000_000_000 + shard * 100 + i,
  };
}

function makeBatchedTree(shardCount: number, filesPerShard: number): FileTree {
  const entries: FileTreeEntry[] = [];
  for (let shard = 0; shard < shardCount; shard++) {
    for (let i = 0; i < filesPerShard; i++) {
      entries.push(makeEntry(shard, i));
    }
  }
  return {
    entries,
    scannedAt: 1_700_000_000_000,
    rootDir: '/workspace',
  };
}

describe('uploadFileTreeV3', () => {
  const mutation = vi.fn().mockResolvedValue(undefined);
  const session = {
    sessionId: 'session-v3',
    machineId: 'machine-v3',
    backend: { mutation },
  } as unknown as DaemonSessionServiceShape;

  beforeEach(() => {
    vi.clearAllMocks();
    mutation.mockResolvedValue(undefined);
  });

  it('batches shards (8 + 2) then writes manifest with complete: true', async () => {
    let filesPerShard = 80;
    let tree = makeBatchedTree(10, filesPerShard);
    while (Buffer.byteLength(JSON.stringify(tree), 'utf8') <= MAX_TREE_JSON_BYTES) {
      filesPerShard += 20;
      tree = makeBatchedTree(10, filesPerShard);
    }

    const result = await uploadFileTreeV3(session, '/workspace', tree, 'gen-test-1');

    const batchCalls = mutation.mock.calls.filter(
      (call) => call[0] === 'mock-syncFileTreeShardV3Batch'
    );
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0]?.[1]?.items).toHaveLength(MAX_SHARD_BATCH_SIZE);
    expect(batchCalls[1]?.[1]?.items.length).toBeLessThanOrEqual(MAX_SHARD_BATCH_SIZE);

    const manifestCall = mutation.mock.calls.find(
      (call) => call[0] === 'mock-syncFileTreeManifestV3'
    );
    expect(manifestCall?.[1]).toEqual(
      expect.objectContaining({
        sessionId: 'session-v3',
        machineId: 'machine-v3',
        workingDir: '/workspace',
        syncGeneration: 'gen-test-1',
        totalEntryCount: tree.entries.length,
        complete: true,
        scannedAt: tree.scannedAt,
      })
    );
    expect(manifestCall?.[1]?.shardIds).toEqual(result.shardIds);
    expect(result.totalEntryCount).toBe(tree.entries.length);
  });

  it('uses session sessionId and machineId in mutation args', async () => {
    const tree = makeBatchedTree(3, 120);
    await uploadFileTreeV3(session, '/workspace', tree, 'gen-test-2');

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          sessionId: 'session-v3',
          machineId: 'machine-v3',
          workingDir: '/workspace',
          syncGeneration: 'gen-test-2',
        })
      );
    }
  });
});
