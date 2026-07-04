/**
 * Workspace File Content — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('workspace file content requests', () => {
  test('requestFileContent rejects unregistered workingDir', async () => {
    const { sessionId } = await createTestSession('test-wfc-unregistered');
    const machineId = 'machine-wfc-unregistered';
    await registerMachineWithDaemon(sessionId, machineId);

    await expect(
      t.mutation(api.workspaceFiles.requestFileContent, {
        sessionId,
        machineId,
        workingDir: '/tmp/unregistered-workspace',
        filePath: 'readme.md',
      })
    ).rejects.toThrow(/not registered/i);
  });
});
