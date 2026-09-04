import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerWorkspaceWithFileTreeSync } from '../helpers/integration';

const WORKING_DIR = '/tmp/purge-test';
const PURGE_BATCH_SIZE = 200;

async function setup(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerWorkspaceWithFileTreeSync(sessionId, machineId, WORKING_DIR);
  return { sessionId, machineId };
}

describe('purgeFileTreeV2', () => {
  test('purges large request backlog in multiple batches', async () => {
    const { sessionId, machineId } = await setup('test-purge-batch', 'machine-purge-batch');

    // Seed > PURGE_BATCH_SIZE request rows for the same workspace
    for (let i = 0; i < PURGE_BATCH_SIZE + 50; i++) {
      await t.mutation(api.workspaceFiles.requestFileTree, {
        sessionId,
        machineId,
        workingDir: `${WORKING_DIR}/`,
        force: i === 0,
      });
    }

    // Loop purge calls until complete
    let result: { complete: boolean };
    do {
      result = await t.mutation(api.workspaceFiles.purgeFileTreeV2, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
      });
    } while (!result.complete);

    // Verify no remaining requests
    const pending = await t.query(api.workspaceFiles.getPendingFileTreeRequests, {
      sessionId,
      machineId,
    });
    expect(pending).toHaveLength(0);
  });
});
