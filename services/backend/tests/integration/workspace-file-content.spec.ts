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

  test('purgeFileContentEntryV2 deletes exact-key rows and is idempotent', async () => {
    const { sessionId } = await createTestSession('test-wfc-purge-entry');
    const machineId = 'machine-wfc-purge-entry';
    await registerMachineWithDaemon(sessionId, machineId);

    const workingDir = '/tmp/purge-entry-test';
    const normalizedWorkingDir = workingDir;
    const targetFilePath = 'target.md';
    const otherFilePath = 'other.md';
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileContentV2', {
        machineId,
        workingDir: normalizedWorkingDir,
        filePath: targetFilePath,
        data: gzipContent('target v2'),
        encoding: 'utf8',
        truncated: false,
        fetchedAt: now,
      });
      await ctx.db.insert('chatroom_workspaceFileContent', {
        machineId,
        workingDir: normalizedWorkingDir,
        filePath: targetFilePath,
        content: 'target v1',
        encoding: 'utf8',
        truncated: false,
        fetchedAt: now,
      });
      await ctx.db.insert('chatroom_workspaceFileContentRequests', {
        machineId,
        workingDir: normalizedWorkingDir,
        filePath: targetFilePath,
        status: 'done',
        requestedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('chatroom_workspaceFileContentV2', {
        machineId,
        workingDir: normalizedWorkingDir,
        filePath: otherFilePath,
        data: gzipContent('other v2'),
        encoding: 'utf8',
        truncated: false,
        fetchedAt: now,
      });
      await ctx.db.insert('chatroom_workspaceFileContent', {
        machineId,
        workingDir: normalizedWorkingDir,
        filePath: otherFilePath,
        content: 'other v1',
        encoding: 'utf8',
        truncated: false,
        fetchedAt: now,
      });
      await ctx.db.insert('chatroom_workspaceFileContentRequests', {
        machineId,
        workingDir: normalizedWorkingDir,
        filePath: otherFilePath,
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.workspaceFiles.purgeFileContentEntryV2, {
      sessionId,
      machineId,
      workingDir: `${workingDir}/`,
      filePath: targetFilePath,
    });

    await t.run(async (ctx) => {
      const targetV2 = await ctx.db
        .query('chatroom_workspaceFileContentV2')
        .withIndex('by_machine_workingDir_path', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', normalizedWorkingDir)
            .eq('filePath', targetFilePath)
        )
        .collect();
      const targetV1 = await ctx.db
        .query('chatroom_workspaceFileContent')
        .withIndex('by_machine_workingDir_path', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', normalizedWorkingDir)
            .eq('filePath', targetFilePath)
        )
        .collect();
      const targetRequests = await ctx.db
        .query('chatroom_workspaceFileContentRequests')
        .withIndex('by_machine_workingDir_path', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', normalizedWorkingDir)
            .eq('filePath', targetFilePath)
        )
        .collect();
      const otherV2 = await ctx.db
        .query('chatroom_workspaceFileContentV2')
        .withIndex('by_machine_workingDir_path', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', normalizedWorkingDir)
            .eq('filePath', otherFilePath)
        )
        .collect();
      const otherV1 = await ctx.db
        .query('chatroom_workspaceFileContent')
        .withIndex('by_machine_workingDir_path', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', normalizedWorkingDir)
            .eq('filePath', otherFilePath)
        )
        .collect();
      const otherRequests = await ctx.db
        .query('chatroom_workspaceFileContentRequests')
        .withIndex('by_machine_workingDir_path', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', normalizedWorkingDir)
            .eq('filePath', otherFilePath)
        )
        .collect();

      expect(targetV2).toHaveLength(0);
      expect(targetV1).toHaveLength(0);
      expect(targetRequests).toHaveLength(0);
      expect(otherV2).toHaveLength(1);
      expect(otherV1).toHaveLength(1);
      expect(otherRequests).toHaveLength(1);
    });

    await t.mutation(api.workspaceFiles.purgeFileContentEntryV2, {
      sessionId,
      machineId,
      workingDir: `${workingDir}/`,
      filePath: targetFilePath,
    });
  });

  test('fulfillFileContentV2 does not recreate cache after entry purge', async () => {
    const { sessionId } = await createTestSession('test-wfc-dismiss-race');
    const machineId = 'machine-wfc-dismiss-race';
    await registerMachineWithDaemon(sessionId, machineId);

    const workingDir = '/tmp/dismiss-race-test';
    const filePath = 'README.md';
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileContentRequests', {
        machineId,
        workingDir,
        filePath,
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.workspaceFiles.purgeFileContentEntryV2, {
      sessionId,
      machineId,
      workingDir,
      filePath,
    });

    await t.mutation(api.workspaceFiles.fulfillFileContentV2, {
      sessionId,
      machineId,
      workingDir,
      filePath,
      data: gzipContent('[Error: workspace not registered]'),
      encoding: 'utf8',
      truncated: false,
    });

    await t.run(async (ctx) => {
      const cached = await ctx.db
        .query('chatroom_workspaceFileContentV2')
        .withIndex('by_machine_workingDir_path', (q) =>
          q.eq('machineId', machineId).eq('workingDir', workingDir).eq('filePath', filePath)
        )
        .collect();
      expect(cached).toHaveLength(0);
    });
  });
});
