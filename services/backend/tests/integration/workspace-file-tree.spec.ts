/**
 * Workspace File Tree — Integration Tests
 *
 * Verifies requestFileTree staleness and force-bypass behavior.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('workspace file tree requests', () => {
  test('requestFileTree returns cached when V2 tree is fresh', async () => {
    const { sessionId } = await createTestSession('test-wft-cached');
    const machineId = 'machine-wft-cached';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeV2', {
        machineId,
        workingDir,
        data: {
          compression: 'gzip',
          content: 'eJyrrgUAAXUA+Q==',
        },
        dataHash: 'fresh-tree-hash',
        scannedAt: Date.now(),
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestFileTree, {
      sessionId,
      machineId,
      workingDir,
    });

    expect(result.status).toBe('cached');
  });

  test('requestFileTree with force bypasses fresh V2 tree staleness', async () => {
    const { sessionId } = await createTestSession('test-wft-force');
    const machineId = 'machine-wft-force';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeV2', {
        machineId,
        workingDir,
        data: {
          compression: 'gzip',
          content: 'eJyrrgUAAXUA+Q==',
        },
        dataHash: 'fresh-tree-hash',
        scannedAt: Date.now(),
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestFileTree, {
      sessionId,
      machineId,
      workingDir,
      force: true,
    });

    expect(result.status).toBe('requested');
  });

  test('requestFileTree treats trailing-slash workingDir as canonical path', async () => {
    const { sessionId } = await createTestSession('test-wft-slash');
    const machineId = 'machine-wft-slash';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeV2', {
        machineId,
        workingDir,
        data: {
          compression: 'gzip',
          content: 'eJyrrgUAAXUA+Q==',
        },
        dataHash: 'fresh-tree-hash',
        scannedAt: Date.now(),
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestFileTree, {
      sessionId,
      machineId,
      workingDir: `${workingDir}/`,
    });

    expect(result.status).toBe('cached');
  });

  test('getFileTreeV2 finds tree stored under canonical workingDir when query uses trailing slash', async () => {
    const { sessionId } = await createTestSession('test-wft-get-slash');
    const machineId = 'machine-wft-get-slash';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeV2', {
        machineId,
        workingDir,
        data: {
          compression: 'gzip',
          content: 'eJyrrgUAAXUA+Q==',
        },
        dataHash: 'fresh-tree-hash',
        scannedAt: Date.now(),
      });
    });

    const tree = await t.query(api.workspaceFiles.getFileTreeV2, {
      sessionId,
      machineId,
      workingDir: `${workingDir}/`,
    });

    expect(tree).not.toBeNull();
    expect(tree?.scannedAt).toBeTypeOf('number');
  });

  test('requestFileTree returns cached when V3 manifest is fresh and complete', async () => {
    const { sessionId } = await createTestSession('test-wft-v3-cached');
    const machineId = 'machine-wft-v3-cached';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeManifestV3', {
        machineId,
        workingDir,
        syncGeneration: 'gen-v3-fresh',
        shardIds: ['src'],
        totalEntryCount: 1,
        complete: true,
        scannedAt: Date.now(),
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestFileTree, {
      sessionId,
      machineId,
      workingDir,
    });

    expect(result.status).toBe('cached');
  });
});
