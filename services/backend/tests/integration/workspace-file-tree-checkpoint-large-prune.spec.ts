import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { FILE_TREE_CHECKPOINT_PRUNE_BATCH_SIZE } from '../../convex/workspaceFileTree/repositories/deltaRepository';
import { t } from '../../test.setup';
import { createTestSession, registerWorkspaceWithFileTreeSync } from '../helpers/integration';

const WORKING_DIR = '/tmp/checkpoint-large-prune';
const ADD_OPERATION = {
  o: 'a' as const,
  p: 'src/index.ts',
  e: 'f' as const,
};
const DELTA_COUNT = FILE_TREE_CHECKPOINT_PRUNE_BATCH_SIZE + 50;

async function setup(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerWorkspaceWithFileTreeSync(sessionId, machineId, WORKING_DIR);
  return { sessionId, machineId };
}

describe('publishFileTreeCheckpoint large delta prune', () => {
  test('prunes covered deltas in bounded batches until complete', async () => {
    const { sessionId, machineId } = await setup(
      'test-checkpoint-large-prune',
      'machine-checkpoint-large-prune'
    );

    for (let i = 0; i < DELTA_COUNT; i++) {
      await t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        operationId: `op-${i}`,
        baseRevision: i,
        operations: [ADD_OPERATION],
      });
    }

    await t.run((ctx) =>
      ctx.db.insert('chatroom_workspaceFileTreeV2', {
        machineId,
        workingDir: WORKING_DIR,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'large-prune-hash',
        scannedAt: 1_700_000_000_000,
      })
    );

    const first = await t.mutation(api.workspaceFiles.publishFileTreeCheckpoint, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      revision: DELTA_COUNT,
      strategyId: 'blob',
      snapshotId: 'large-prune-hash',
    });
    expect(first).toEqual({
      status: 'published',
      revision: DELTA_COUNT,
      prunedDeltaCount: FILE_TREE_CHECKPOINT_PRUNE_BATCH_SIZE,
      pruneComplete: false,
    });

    const remainingAfterFirst = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query('chatroom_workspaceFileTreeDelta')
            .withIndex('by_machine_workingDir_revision', (q) =>
              q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
            )
            .collect()
        ).length
    );
    expect(remainingAfterFirst).toBe(DELTA_COUNT - FILE_TREE_CHECKPOINT_PRUNE_BATCH_SIZE);

    const second = await t.mutation(api.workspaceFiles.publishFileTreeCheckpoint, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      revision: DELTA_COUNT,
      strategyId: 'blob',
      snapshotId: 'large-prune-hash',
    });
    expect(second).toEqual({
      status: 'unchanged',
      revision: DELTA_COUNT,
      prunedDeltaCount: DELTA_COUNT - FILE_TREE_CHECKPOINT_PRUNE_BATCH_SIZE,
      pruneComplete: true,
    });

    const remaining = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query('chatroom_workspaceFileTreeDelta')
            .withIndex('by_machine_workingDir_revision', (q) =>
              q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
            )
            .collect()
        ).length
    );
    expect(remaining).toBe(0);
  });
});
