/**
 * Workspace Directory Listing — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

const WORKING_DIR = '/tmp/workspace';

async function registerWorkspace(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId: sessionId as never,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

async function setupMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await registerWorkspace(sessionId, chatroomId, machineId, WORKING_DIR);
  return { sessionId, machineId };
}

describe('workspace dir listing requests', () => {
  test('requestDirListing returns cached when fresh', async () => {
    const { sessionId, machineId } = await setupMachine('test-wdl-cached', 'machine-wdl-cached');
    const dirPath = '';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceDirListingV2', {
        machineId,
        workingDir: WORKING_DIR,
        dirPath,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'fresh-dir-hash',
        scannedAt: Date.now(),
        truncated: false,
        totalCount: 0,
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestDirListing, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      dirPath,
    });

    expect(result.status).toBe('cached');
  });

  test('requestDirListing returns cached when scanned within 10s', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wdl-within-10s',
      'machine-wdl-within-10s'
    );
    const dirPath = 'src';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceDirListingV2', {
        machineId,
        workingDir: WORKING_DIR,
        dirPath,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'within-10s-dir-hash',
        scannedAt: Date.now() - 5_000,
        truncated: false,
        totalCount: 1,
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestDirListing, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      dirPath,
    });

    expect(result.status).toBe('cached');
  });

  test('requestDirListing requests refresh when scanned older than 10s', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wdl-older-10s',
      'machine-wdl-older-10s'
    );
    const dirPath = 'src';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceDirListingV2', {
        machineId,
        workingDir: WORKING_DIR,
        dirPath,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'older-10s-dir-hash',
        scannedAt: Date.now() - 15_000,
        truncated: false,
        totalCount: 1,
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestDirListing, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      dirPath,
    });

    expect(result.status).not.toBe('cached');
    expect(result.status).toBe('requested');
  });

  test('requestDirListing with force creates pending request', async () => {
    const { sessionId, machineId } = await setupMachine('test-wdl-force', 'machine-wdl-force');
    const dirPath = 'src';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceDirListingV2', {
        machineId,
        workingDir: WORKING_DIR,
        dirPath,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'fresh-dir-hash',
        scannedAt: Date.now(),
        truncated: false,
        totalCount: 1,
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestDirListing, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      dirPath,
      force: true,
    });

    expect(result.status).toBe('requested');
  });

  test('requestDirListing rejects unregistered workingDir', async () => {
    const { sessionId } = await createTestSession('test-wdl-unregistered');
    const machineId = 'machine-wdl-unregistered';
    await registerMachineWithDaemon(sessionId, machineId);

    await expect(
      t.mutation(api.workspaceFiles.requestDirListing, {
        sessionId,
        machineId,
        workingDir: '/tmp/unregistered-workspace',
        dirPath: '',
      })
    ).rejects.toThrow(/not registered/i);
  });

  test('requestFileSearch with force bypasses staleness', async () => {
    const { sessionId, machineId } = await setupMachine('test-wfs-force', 'machine-wfs-force');
    const query = 'app';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileSearchV2', {
        machineId,
        workingDir: WORKING_DIR,
        query,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'search-hash',
        scannedAt: Date.now(),
        truncated: false,
        totalCount: 1,
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestFileSearch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      query,
      force: true,
    });

    expect(result.status).toBe('requested');
  });

  test('requestFileSearch returns cached when scanned within 10s', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfs-within-10s',
      'machine-wfs-within-10s'
    );
    const query = 'app';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileSearchV2', {
        machineId,
        workingDir: WORKING_DIR,
        query,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'within-10s-search-hash',
        scannedAt: Date.now() - 5_000,
        truncated: false,
        totalCount: 1,
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestFileSearch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      query,
    });

    expect(result.status).toBe('cached');
  });

  test('requestFileSearch requests refresh when scanned older than 10s', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfs-older-10s',
      'machine-wfs-older-10s'
    );
    const query = 'app';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileSearchV2', {
        machineId,
        workingDir: WORKING_DIR,
        query,
        data: { compression: 'gzip', content: 'eJyrrgUAAXUA+Q==' },
        dataHash: 'older-10s-search-hash',
        scannedAt: Date.now() - 15_000,
        truncated: false,
        totalCount: 1,
      });
    });

    const result = await t.mutation(api.workspaceFiles.requestFileSearch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      query,
    });

    expect(result.status).not.toBe('cached');
    expect(result.status).toBe('requested');
  });
});
