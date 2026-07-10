/**
 * Workspace File Tree Shard V3 — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const GZIP_PAYLOAD = { compression: 'gzip' as const, content: 'eJyrrgUAAXUA+Q==' };

describe('workspace file tree shard v3', () => {
  test('syncFileTreeShardV3Batch writes two shards', async () => {
    const { sessionId } = await createTestSession('test-ft-shard-write');
    const machineId = 'machine-ft-shard-write';
    const workingDir = '/tmp/workspace';
    const syncGeneration = 'gen-write-1';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.mutation(api.workspaceFiles.syncFileTreeShardV3Batch, {
      sessionId,
      machineId,
      workingDir,
      syncGeneration,
      items: [
        {
          shardId: '__root__',
          data: GZIP_PAYLOAD,
          dataHash: 'root-hash',
          scannedAt: 1_700_000_000_000,
          entryCount: 10,
        },
        {
          shardId: 'src',
          data: GZIP_PAYLOAD,
          dataHash: 'src-hash',
          scannedAt: 1_700_000_000_000,
          entryCount: 5,
        },
      ],
    });

    expect(result).toEqual({ written: 2, skipped: 0 });
  });

  test('re-upload same dataHash returns skipped', async () => {
    const { sessionId } = await createTestSession('test-ft-shard-skip');
    const machineId = 'machine-ft-shard-skip';
    const workingDir = '/tmp/workspace';
    const syncGeneration = 'gen-skip-1';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeShardV3', {
        machineId,
        workingDir,
        shardId: '__root__',
        syncGeneration,
        data: GZIP_PAYLOAD,
        dataHash: 'existing-hash',
        scannedAt: 1,
        entryCount: 1,
      });
      await ctx.db.insert('chatroom_workspaceFileTreeShardV3', {
        machineId,
        workingDir,
        shardId: 'src',
        syncGeneration,
        data: GZIP_PAYLOAD,
        dataHash: 'existing-src-hash',
        scannedAt: 1,
        entryCount: 1,
      });
    });

    const result = await t.mutation(api.workspaceFiles.syncFileTreeShardV3Batch, {
      sessionId,
      machineId,
      workingDir,
      syncGeneration,
      items: [
        {
          shardId: '__root__',
          data: GZIP_PAYLOAD,
          dataHash: 'existing-hash',
          scannedAt: Date.now(),
          entryCount: 1,
        },
        {
          shardId: 'src',
          data: GZIP_PAYLOAD,
          dataHash: 'existing-src-hash',
          scannedAt: Date.now(),
          entryCount: 1,
        },
      ],
    });

    expect(result).toEqual({ written: 0, skipped: 2 });
  });

  test('syncFileTreeManifestV3 writes manifest with complete true', async () => {
    const { sessionId } = await createTestSession('test-ft-manifest-write');
    const machineId = 'machine-ft-manifest-write';
    const workingDir = '/tmp/workspace';
    const syncGeneration = 'gen-manifest-1';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaceFiles.syncFileTreeManifestV3, {
      sessionId,
      machineId,
      workingDir,
      syncGeneration,
      shardIds: ['__root__', 'src'],
      totalEntryCount: 15,
      complete: true,
      scannedAt: 1_700_000_000_000,
    });

    const manifest = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_workspaceFileTreeManifestV3')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', workingDir)
        )
        .first()
    );

    expect(manifest).toMatchObject({
      syncGeneration,
      shardIds: ['__root__', 'src'],
      totalEntryCount: 15,
      complete: true,
      scannedAt: 1_700_000_000_000,
    });
  });

  test('getFileTreeManifestV3 returns manifest fields', async () => {
    const { sessionId } = await createTestSession('test-ft-manifest-query');
    const machineId = 'machine-ft-manifest-query';
    const workingDir = '/tmp/workspace';
    const syncGeneration = 'gen-query-1';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeManifestV3', {
        machineId,
        workingDir,
        syncGeneration,
        shardIds: ['__root__'],
        totalEntryCount: 42,
        complete: true,
        scannedAt: 99,
      });
    });

    const manifest = await t.query(api.workspaceFiles.getFileTreeManifestV3, {
      sessionId,
      machineId,
      workingDir,
    });

    expect(manifest).toEqual({
      syncGeneration,
      shardIds: ['__root__'],
      totalEntryCount: 42,
      complete: true,
      scannedAt: 99,
    });
  });

  test('getFileTreeShardsV3 returns shards for generation', async () => {
    const { sessionId } = await createTestSession('test-ft-shards-query');
    const machineId = 'machine-ft-shards-query';
    const workingDir = '/tmp/workspace';
    const syncGeneration = 'gen-shards-query';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaceFiles.syncFileTreeShardV3Batch, {
      sessionId,
      machineId,
      workingDir,
      syncGeneration,
      items: [
        {
          shardId: '__root__',
          data: GZIP_PAYLOAD,
          dataHash: 'root-hash',
          scannedAt: 100,
          entryCount: 3,
        },
        {
          shardId: 'src',
          data: GZIP_PAYLOAD,
          dataHash: 'src-hash',
          scannedAt: 100,
          entryCount: 7,
        },
      ],
    });

    const shards = await t.query(api.workspaceFiles.getFileTreeShardsV3, {
      sessionId,
      machineId,
      workingDir,
      syncGeneration,
    });

    expect(shards).toHaveLength(2);
    expect(shards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shardId: '__root__', dataHash: 'root-hash', entryCount: 3 }),
        expect.objectContaining({ shardId: 'src', dataHash: 'src-hash', entryCount: 7 }),
      ])
    );
  });

  test('new syncGeneration in manifest purges old generation shards', async () => {
    const { sessionId } = await createTestSession('test-ft-gen-purge');
    const machineId = 'machine-ft-gen-purge';
    const workingDir = '/tmp/workspace';
    const oldGeneration = 'gen-old';
    const newGeneration = 'gen-new';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaceFiles.syncFileTreeShardV3Batch, {
      sessionId,
      machineId,
      workingDir,
      syncGeneration: oldGeneration,
      items: [
        {
          shardId: '__root__',
          data: GZIP_PAYLOAD,
          dataHash: 'old-hash',
          scannedAt: 1,
          entryCount: 1,
        },
      ],
    });

    await t.mutation(api.workspaceFiles.syncFileTreeManifestV3, {
      sessionId,
      machineId,
      workingDir,
      syncGeneration: oldGeneration,
      shardIds: ['__root__'],
      totalEntryCount: 1,
      complete: true,
      scannedAt: 1,
    });

    await t.mutation(api.workspaceFiles.syncFileTreeManifestV3, {
      sessionId,
      machineId,
      workingDir,
      syncGeneration: newGeneration,
      shardIds: ['src'],
      totalEntryCount: 2,
      complete: true,
      scannedAt: 2,
    });

    const oldShards = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_workspaceFileTreeShardV3')
        .withIndex('by_machine_workingDir_syncGeneration', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', workingDir)
            .eq('syncGeneration', oldGeneration)
        )
        .collect()
    );

    expect(oldShards).toHaveLength(0);

    const manifest = await t.query(api.workspaceFiles.getFileTreeManifestV3, {
      sessionId,
      machineId,
      workingDir,
    });
    expect(manifest?.syncGeneration).toBe(newGeneration);
  });
});
