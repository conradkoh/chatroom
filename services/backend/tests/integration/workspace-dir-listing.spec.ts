/**
 * Workspace Directory Listing — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('workspace dir listing requests', () => {
  test('requestDirListing returns cached when fresh', async () => {
    const { sessionId } = await createTestSession('test-wdl-cached');
    const machineId = 'machine-wdl-cached';
    const workingDir = '/tmp/workspace';
    const dirPath = '';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceDirListingV2', {
        machineId,
        workingDir,
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
      workingDir,
      dirPath,
    });

    expect(result.status).toBe('cached');
  });

  test('requestDirListing with force creates pending request', async () => {
    const { sessionId } = await createTestSession('test-wdl-force');
    const machineId = 'machine-wdl-force';
    const workingDir = '/tmp/workspace';
    const dirPath = 'src';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceDirListingV2', {
        machineId,
        workingDir,
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
      workingDir,
      dirPath,
      force: true,
    });

    expect(result.status).toBe('requested');
  });

  test('requestFileSearch with force bypasses staleness', async () => {
    const { sessionId } = await createTestSession('test-wfs-force');
    const machineId = 'machine-wfs-force';
    const workingDir = '/tmp/workspace';
    const query = 'app';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileSearchV2', {
        machineId,
        workingDir,
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
      workingDir,
      query,
      force: true,
    });

    expect(result.status).toBe('requested');
  });
});
