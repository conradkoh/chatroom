/**
 * Incremental Workspace File Tree — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const WORKING_DIR = '/tmp/incremental-workspace';

async function setup(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

const ADD_OPERATION = {
  operation: 'add' as const,
  path: 'src/index.ts',
  entryType: 'file' as const,
  size: 42,
  modifiedAt: 1_700_000_000_000,
};

describe('incremental workspace file tree', () => {
  test('preserves explicit recovery intent on pending daemon requests', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-force-request',
      'machine-file-tree-force-request'
    );

    await t.mutation(api.workspaceFiles.requestFileTree, {
      sessionId,
      machineId,
      workingDir: `${WORKING_DIR}/`,
      force: true,
    });

    const pending = await t.query(api.workspaceFiles.getPendingFileTreeRequests, {
      sessionId,
      machineId,
    });
    expect(pending).toEqual([expect.objectContaining({ workingDir: WORKING_DIR, force: true })]);
  });

  test('appends ordered deltas, normalizes workingDir, and deduplicates retries', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-delta-append',
      'machine-file-tree-delta-append'
    );

    const applied = await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
      sessionId,
      machineId,
      workingDir: `${WORKING_DIR}/`,
      operationId: 'watch-batch-1',
      baseRevision: 0,
      operations: [ADD_OPERATION],
    });
    expect(applied).toEqual({ status: 'applied', revision: 1 });

    const result = await t.query(api.workspaceFiles.getFileTreeDeltas, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      afterRevision: 0,
    });
    expect(result).toMatchObject({
      status: 'ok',
      checkpointRevision: 0,
      currentRevision: 1,
      hasMore: false,
      deltas: [
        {
          operationId: 'watch-batch-1',
          baseRevision: 0,
          revision: 1,
          operations: [ADD_OPERATION],
        },
      ],
    });

    // Idempotency is checked before base revision, as required for network retries.
    const duplicate = await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      operationId: 'watch-batch-1',
      baseRevision: 0,
      operations: [ADD_OPERATION],
    });
    expect(duplicate).toEqual({ status: 'duplicate', revision: 1 });
  });

  test('returns resync-required without writing when base revision is stale', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-delta-stale',
      'machine-file-tree-delta-stale'
    );

    await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      operationId: 'watch-batch-1',
      baseRevision: 0,
      operations: [ADD_OPERATION],
    });
    const stale = await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      operationId: 'watch-batch-stale',
      baseRevision: 0,
      operations: [{ operation: 'remove', path: 'src/index.ts' }],
    });

    expect(stale).toEqual({ status: 'resync-required', expectedRevision: 1 });
    const receipts = await t.run((ctx) =>
      ctx.db
        .query('chatroom_workspaceFileTreeDeltaOperation')
        .withIndex('by_machine_workingDir_operationId', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .collect()
    );
    expect(receipts).toHaveLength(1);
  });

  test('publishes a verified V2 checkpoint before pruning covered delta payloads', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-checkpoint',
      'machine-file-tree-checkpoint'
    );

    await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      operationId: 'watch-batch-before-checkpoint',
      baseRevision: 0,
      operations: [ADD_OPERATION],
    });
    await t.run((ctx) =>
      ctx.db.insert('chatroom_workspaceFileTreeV2', {
        machineId,
        workingDir: WORKING_DIR,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'cache-checkpoint-hash',
        scannedAt: 1_700_000_000_000,
      })
    );

    const published = await t.mutation(api.workspaceFiles.publishFileTreeCheckpoint, {
      sessionId,
      machineId,
      workingDir: `${WORKING_DIR}/`,
      revision: 1,
      snapshotKind: 'v2',
      snapshotId: 'cache-checkpoint-hash',
    });
    expect(published).toEqual({
      status: 'published',
      revision: 1,
      prunedDeltaCount: 1,
    });

    const checkpoint = await t.query(api.workspaceFiles.getFileTreeCheckpoint, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
    });
    expect(checkpoint).toMatchObject({
      revision: 1,
      snapshotKind: 'v2',
      snapshotId: 'cache-checkpoint-hash',
    });

    const behind = await t.query(api.workspaceFiles.getFileTreeDeltas, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      afterRevision: 0,
    });
    expect(behind).toEqual({
      status: 'checkpoint-required',
      checkpointRevision: 1,
      currentRevision: 1,
    });

    const rows = await t.run(async (ctx) => ({
      deltas: await ctx.db
        .query('chatroom_workspaceFileTreeDelta')
        .withIndex('by_machine_workingDir_revision', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .collect(),
      receipts: await ctx.db
        .query('chatroom_workspaceFileTreeDeltaOperation')
        .withIndex('by_machine_workingDir_operationId', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .collect(),
    }));
    expect(rows.deltas).toHaveLength(0);
    expect(rows.receipts).toHaveLength(1);

    const duplicateAfterCompaction = await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      operationId: 'watch-batch-before-checkpoint',
      baseRevision: 0,
      operations: [ADD_OPERATION],
    });
    expect(duplicateAfterCompaction).toEqual({ status: 'duplicate', revision: 1 });
  });

  test('does not publish metadata or prune deltas for a missing snapshot', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-checkpoint-missing',
      'machine-file-tree-checkpoint-missing'
    );
    await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      operationId: 'watch-batch-uncheckpointed',
      baseRevision: 0,
      operations: [ADD_OPERATION],
    });

    const result = await t.mutation(api.workspaceFiles.publishFileTreeCheckpoint, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      revision: 1,
      snapshotKind: 'v3',
      snapshotId: 'missing-generation',
    });
    expect(result).toEqual({ status: 'snapshot-missing' });

    const deltaCount = await t.run(async (ctx) => {
      const deltas = await ctx.db
        .query('chatroom_workspaceFileTreeDelta')
        .withIndex('by_machine_workingDir_revision', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .collect();
      return deltas.length;
    });
    expect(deltaCount).toBe(1);
  });

  test('can advance one revision when a fresh scan replaces an existing checkpoint', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-checkpoint-replace',
      'machine-file-tree-checkpoint-replace'
    );
    await t.run((ctx) =>
      ctx.db.insert('chatroom_workspaceFileTreeV2', {
        machineId,
        workingDir: WORKING_DIR,
        data: { compression: 'gzip', content: 'replacement' },
        dataHash: 'replacement-hash',
        scannedAt: Date.now(),
      })
    );

    const result = await t.mutation(api.workspaceFiles.publishFileTreeCheckpoint, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      revision: 1,
      snapshotKind: 'v2',
      snapshotId: 'replacement-hash',
    });

    expect(result).toMatchObject({ status: 'published', revision: 1 });
    expect(
      await t.query(api.workspaceFiles.getFileTreeCheckpoint, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
      })
    ).toMatchObject({ revision: 1, snapshotId: 'replacement-hash' });
  });

  test('does not expose or accept deltas without machine access', async () => {
    const { sessionId: ownerSessionId, machineId } = await setup(
      'test-file-tree-delta-owner',
      'machine-file-tree-delta-private'
    );
    const { sessionId: otherSessionId } = await createTestSession(
      'test-file-tree-delta-other-user'
    );

    await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
      sessionId: ownerSessionId,
      machineId,
      workingDir: WORKING_DIR,
      operationId: 'private-batch',
      baseRevision: 0,
      operations: [ADD_OPERATION],
    });

    await expect(
      t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
        sessionId: otherSessionId,
        machineId,
        workingDir: WORKING_DIR,
        operationId: 'unauthorized-batch',
        baseRevision: 1,
        operations: [{ operation: 'remove', path: 'src/index.ts' }],
      })
    ).rejects.toThrow();
    await expect(
      t.query(api.workspaceFiles.getFileTreeDeltas, {
        sessionId: otherSessionId,
        machineId,
        workingDir: WORKING_DIR,
        afterRevision: 0,
      })
    ).resolves.toBeNull();
  });
});
