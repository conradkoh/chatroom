/**
 * Workspace File Content — Integration Tests
 */

import { gzipSync } from 'node:zlib';

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

function gzipContent(text: string) {
  return {
    compression: 'gzip' as const,
    content: gzipSync(Buffer.from(text)).toString('base64'),
  };
}

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

  test('requestFileContent returns cached when v2 cache is fresh', async () => {
    const { sessionId } = await createTestSession('test-wfc-v2-cached');
    const machineId = 'machine-wfc-v2-cached';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId: sessionId as never,
      chatroomId,
      machineId,
      workingDir: '/tmp/v2-cache-test',
      hostname: 'test-host',
      registeredBy: 'builder',
    });

    const filePath = 'hello.md';
    const workingDir = '/tmp/v2-cache-test';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileContentV2', {
        machineId,
        workingDir,
        filePath,
        data: gzipContent('cached content'),
        encoding: 'utf8',
        truncated: false,
        fetchedAt: Date.now(),
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestFileContent, {
      sessionId,
      machineId,
      workingDir,
      filePath,
    });

    expect(result.status).toBe('cached');
  });
});
