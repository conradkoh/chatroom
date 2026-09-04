/** Integration coverage for fail-closed file-tree synchronization boundaries. */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  registerWorkspaceWithFileTreeSync,
  registerMachineWithDaemon,
} from '../helpers/integration';

const GZIP_PAYLOAD = { compression: 'gzip' as const, content: 'eJyrrgUAAXUA+Q==' };

async function setupWorkspace(
  sessionKey: string,
  machineId: string,
  workingDir: string,
  enabled = false
) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  const workspaceId = await registerWorkspaceWithFileTreeSync(sessionId, machineId, workingDir);
  if (!enabled) {
    await t.mutation(api.workspaces.setFileTreeSyncEnabled, {
      sessionId,
      workspaceId,
      enabled: false,
    });
  }
  return { sessionId, machineId, workspaceId };
}

async function removeSyncSetting(workspaceId: Id<'chatroom_workspaces'>) {
  await t.run(async (ctx) => {
    await ctx.db.patch('chatroom_workspaces', workspaceId, { fileTreeSyncEnabled: undefined });
  });
}

async function expectFileTreeSyncDisabled(action: () => Promise<unknown>) {
  try {
    await action();
    throw new Error('Expected file-tree sync to be rejected');
  } catch (error) {
    expect(error).toMatchObject({ data: { code: 'FILE_TREE_SYNC_DISABLED' } });
  }
}

describe('disabled workspace file-tree synchronization', () => {
  test('requestFileTree rejects disabled and legacy workspaces', async () => {
    const disabled = await setupWorkspace(
      'test-file-tree-sync-disabled-request',
      'machine-file-tree-sync-disabled-request',
      '/tmp/file-tree-sync-disabled-request'
    );
    await expectFileTreeSyncDisabled(() =>
      t.mutation(api.workspaceFiles.requestFileTree, {
        sessionId: disabled.sessionId,
        machineId: disabled.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-request',
      })
    );

    const legacy = await setupWorkspace(
      'test-file-tree-sync-legacy-request',
      'machine-file-tree-sync-legacy-request',
      '/tmp/file-tree-sync-legacy-request'
    );
    await removeSyncSetting(legacy.workspaceId);
    await expectFileTreeSyncDisabled(() =>
      t.mutation(api.workspaceFiles.requestFileTree, {
        sessionId: legacy.sessionId,
        machineId: legacy.machineId,
        workingDir: '/tmp/file-tree-sync-legacy-request',
      })
    );
  });

  test('syncFileTreeV2 rejects a disabled workspace', async () => {
    const setup = await setupWorkspace(
      'test-file-tree-sync-disabled-v2',
      'machine-file-tree-sync-disabled-v2',
      '/tmp/file-tree-sync-disabled-v2'
    );

    await expectFileTreeSyncDisabled(() =>
      t.mutation(api.workspaceFiles.syncFileTreeV2, {
        sessionId: setup.sessionId,
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-v2',
        data: GZIP_PAYLOAD,
        dataHash: 'disabled-v2-hash',
        scannedAt: Date.now(),
      })
    );
  });

  test('applyFileTreeDeltaBatch rejects a disabled workspace', async () => {
    const setup = await setupWorkspace(
      'test-file-tree-sync-disabled-delta',
      'machine-file-tree-sync-disabled-delta',
      '/tmp/file-tree-sync-disabled-delta'
    );

    await expectFileTreeSyncDisabled(() =>
      t.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
        sessionId: setup.sessionId,
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-delta',
        operationId: 'disabled-delta-operation',
        baseRevision: 0,
        operations: [{ o: 'a', p: 'src/index.ts', e: 'f' }],
      })
    );
  });

  test('positive watch acquisition rejects but negative release succeeds when disabled', async () => {
    const setup = await setupWorkspace(
      'test-file-tree-sync-disabled-watch',
      'machine-file-tree-sync-disabled-watch',
      '/tmp/file-tree-sync-disabled-watch'
    );
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeWatches', {
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-watch',
        watchCount: 1,
        expiresAt: Date.now() + 60_000,
        updatedAt: Date.now(),
      });
    });

    await expectFileTreeSyncDisabled(() =>
      t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
        sessionId: setup.sessionId,
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-watch',
        delta: 1,
      })
    );

    await expect(
      t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
        sessionId: setup.sessionId,
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-watch',
        delta: -1,
      })
    ).resolves.toEqual({ watchCount: 0 });
  });

  test('renewFileTreeWatchLease rejects a disabled workspace', async () => {
    const setup = await setupWorkspace(
      'test-file-tree-sync-disabled-renew',
      'machine-file-tree-sync-disabled-renew',
      '/tmp/file-tree-sync-disabled-renew'
    );
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeWatches', {
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-renew',
        watchCount: 1,
        expiresAt: Date.now() + 60_000,
        updatedAt: Date.now(),
      });
    });

    await expectFileTreeSyncDisabled(() =>
      t.mutation(api.workspaceFiles.renewFileTreeWatchLease, {
        sessionId: setup.sessionId,
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-renew',
      })
    );
  });

  test('syncFileTreeV2 succeeds after explicitly enabling a workspace', async () => {
    const setup = await setupWorkspace(
      'test-file-tree-sync-enabled-v2',
      'machine-file-tree-sync-enabled-v2',
      '/tmp/file-tree-sync-enabled-v2',
      true
    );

    await expect(
      t.mutation(api.workspaceFiles.syncFileTreeV2, {
        sessionId: setup.sessionId,
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-enabled-v2',
        data: GZIP_PAYLOAD,
        dataHash: 'enabled-v2-hash',
        scannedAt: Date.now(),
      })
    ).resolves.toBeNull();
  });

  test('getPendingFileTreeRequests omits a disabled workspace request', async () => {
    const setup = await setupWorkspace(
      'test-file-tree-sync-disabled-pending',
      'machine-file-tree-sync-disabled-pending',
      '/tmp/file-tree-sync-disabled-pending'
    );
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeRequests', {
        machineId: setup.machineId,
        workingDir: '/tmp/file-tree-sync-disabled-pending',
        status: 'pending',
        force: false,
        requestedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.query(api.workspaceFiles.getPendingFileTreeRequests, {
        sessionId: setup.sessionId,
        machineId: setup.machineId,
      })
    ).resolves.toEqual([]);
  });
});
