/**
 * Workspace Directory Listing Batch Sync — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('workspace dir listing batch sync', () => {
  test('batch with two dirs writes both rows', async () => {
    const { sessionId } = await createTestSession('test-wdl-batch-write');
    const machineId = 'machine-wdl-batch-write';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.mutation(api.workspaceFiles.syncDirListingV2Batch, {
      sessionId,
      machineId,
      workingDir,
      items: [
        {
          dirPath: '',
          data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
          dataHash: 'root-hash',
          scannedAt: Date.now(),
          truncated: false,
          totalCount: 1,
        },
        {
          dirPath: 'src',
          data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
          dataHash: 'src-hash',
          scannedAt: Date.now(),
          truncated: false,
          totalCount: 2,
        },
      ],
    });

    expect(result).toEqual({ written: 2, skipped: 0 });

    const root = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_workspaceDirListingV2')
        .withIndex('by_machine_workingDir_dirPath', (q) =>
          q.eq('machineId', machineId).eq('workingDir', workingDir).eq('dirPath', '')
        )
        .first()
    );
    const src = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_workspaceDirListingV2')
        .withIndex('by_machine_workingDir_dirPath', (q) =>
          q.eq('machineId', machineId).eq('workingDir', workingDir).eq('dirPath', 'src')
        )
        .first()
    );

    expect(root?.dataHash).toBe('root-hash');
    expect(src?.dataHash).toBe('src-hash');
  });

  test('batch skips item when dataHash unchanged', async () => {
    const { sessionId } = await createTestSession('test-wdl-batch-skip');
    const machineId = 'machine-wdl-batch-skip';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceDirListingV2', {
        machineId,
        workingDir,
        dirPath: '',
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'existing-hash',
        scannedAt: 1,
        truncated: false,
        totalCount: 1,
      });
    });

    const result = await t.mutation(api.workspaceFiles.syncDirListingV2Batch, {
      sessionId,
      machineId,
      workingDir,
      items: [
        {
          dirPath: '',
          data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
          dataHash: 'existing-hash',
          scannedAt: Date.now(),
          truncated: false,
          totalCount: 1,
        },
        {
          dirPath: 'src',
          data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
          dataHash: 'new-src-hash',
          scannedAt: Date.now(),
          truncated: false,
          totalCount: 1,
        },
      ],
    });

    expect(result).toEqual({ written: 1, skipped: 1 });
  });

  test('empty items returns written 0 skipped 0', async () => {
    const { sessionId } = await createTestSession('test-wdl-batch-empty');
    const machineId = 'machine-wdl-batch-empty';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.mutation(api.workspaceFiles.syncDirListingV2Batch, {
      sessionId,
      machineId,
      workingDir,
      items: [],
    });

    expect(result).toEqual({ written: 0, skipped: 0 });
  });

  test('syncDirListingV2 skips write when dataHash unchanged', async () => {
    const { sessionId } = await createTestSession('test-wdl-single-skip');
    const machineId = 'machine-wdl-single-skip';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceDirListingV2', {
        machineId,
        workingDir,
        dirPath: '',
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'existing-hash',
        scannedAt: 1,
        truncated: false,
        totalCount: 1,
      });
    });

    await t.mutation(api.workspaceFiles.syncDirListingV2, {
      sessionId,
      machineId,
      workingDir,
      dirPath: '',
      data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
      dataHash: 'existing-hash',
      scannedAt: Date.now(),
      truncated: false,
      totalCount: 1,
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_workspaceDirListingV2')
        .withIndex('by_machine_workingDir_dirPath', (q) =>
          q.eq('machineId', machineId).eq('workingDir', workingDir).eq('dirPath', '')
        )
        .first()
    );

    expect(row?.scannedAt).toBe(1);
  });
});
