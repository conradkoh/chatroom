/**
 * Workspace File Write — Integration Tests
 *
 * Verifies request/fulfill flow for async file writes via daemon.
 */

import { gzipSync } from 'node:zlib';

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

function gzipContent(text: string) {
  return {
    compression: 'gzip' as const,
    content: gzipSync(Buffer.from(text)).toString('base64'),
  };
}

describe('workspace file write requests', () => {
  test('requestFileWrite creates a pending request with validated path', async () => {
    const { sessionId, machineId } = await setupMachine('test-wfw-create', 'machine-wfw-create');

    const result = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'docs/readme.md',
      operation: 'create',
      data: gzipContent('# Hello'),
    });

    expect(result.status).toBe('requested');
    expect(result.requestId).toBeDefined();

    const request = await t.query(api.workspaceFiles.getFileWriteRequest, {
      sessionId,
      requestId: result.requestId,
    });
    expect(request?.status).toBe('pending');

    const pending = await t.query(api.workspaceFiles.getPendingFileWriteRequests, {
      sessionId,
      machineId,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.filePath).toBe('docs/readme.md');
    expect(pending[0]?.operation).toBe('create');
  });

  test('requestFileWrite rejects unregistered workingDir', async () => {
    const { sessionId } = await createTestSession('test-wfw-unregistered-wd');
    const machineId = 'machine-wfw-unregistered-wd';
    await registerMachineWithDaemon(sessionId, machineId);

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: '/tmp/unregistered-workspace',
        filePath: 'foo.md',
        operation: 'create',
        data: gzipContent('x'),
      })
    ).rejects.toThrow(/not registered/i);
  });

  test('requestFileWrite accepts registered workingDir', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-registered-wd',
      'machine-wfw-registered-wd'
    );

    const result = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'registered.md',
      operation: 'create',
      data: gzipContent('ok'),
    });

    expect(result.status).toBe('requested');
  });

  test('requestFileWrite rejects path traversal', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-traversal',
      'machine-wfw-traversal'
    );

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        filePath: '../etc/passwd',
        operation: 'create',
        data: gzipContent('bad'),
      })
    ).rejects.toThrow(/path traversal/i);
  });

  test('requestFileWrite returns pending when same path already has pending request', async () => {
    const { sessionId, machineId } = await setupMachine('test-wfw-dedup', 'machine-wfw-dedup');

    const first = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'notes.md',
      operation: 'create',
      data: gzipContent('v1'),
    });

    const second = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'notes.md',
      operation: 'update',
      data: gzipContent('v2'),
    });

    expect(first.requestId).toBe(second.requestId);
    expect(second.status).toBe('pending');
  });

  test('completeFileWriteRequest sets done and purges cached content', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-complete',
      'machine-wfw-complete'
    );
    const filePath = 'src/app.ts';

    const { requestId } = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath,
      operation: 'update',
      data: gzipContent('export {}'),
    });

    const cacheId = await t.run(async (ctx) => {
      return ctx.db.insert('chatroom_workspaceFileContentV2', {
        machineId,
        workingDir: WORKING_DIR,
        filePath,
        data: gzipContent('stale'),
        encoding: 'utf8',
        truncated: false,
        fetchedAt: Date.now(),
      });
    });

    await t.mutation(api.workspaceFiles.completeFileWriteRequest, {
      sessionId,
      requestId,
      status: 'done',
    });

    const request = await t.query(api.workspaceFiles.getFileWriteRequest, {
      sessionId,
      requestId,
    });
    expect(request?.status).toBe('done');

    const cached = await t.run(async (ctx) =>
      ctx.db.get('chatroom_workspaceFileContentV2', cacheId)
    );
    expect(cached).toBeNull();
  });

  test('completeFileWriteRequest sets error with message', async () => {
    const { sessionId, machineId } = await setupMachine('test-wfw-error', 'machine-wfw-error');

    const { requestId } = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'missing.ts',
      operation: 'update',
      data: gzipContent('noop'),
    });

    await t.mutation(api.workspaceFiles.completeFileWriteRequest, {
      sessionId,
      requestId,
      status: 'error',
      errorMessage: 'File does not exist',
    });

    const request = await t.query(api.workspaceFiles.getFileWriteRequest, {
      sessionId,
      requestId,
    });
    expect(request?.status).toBe('error');
    expect(request?.errorMessage).toBe('File does not exist');
  });

  test('requestFileWrite creates a pending delete request without data', async () => {
    const { sessionId, machineId } = await setupMachine('test-wfw-delete', 'machine-wfw-delete');

    const result = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'docs/readme.md',
      operation: 'delete',
    });

    expect(result.status).toBe('requested');

    const pending = await t.query(api.workspaceFiles.getPendingFileWriteRequests, {
      sessionId,
      machineId,
    });
    expect(pending[0]?.operation).toBe('delete');
    expect(pending[0]?.data).toBeUndefined();
  });

  test('requestFileWrite rejects delete with data payload', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-delete-data',
      'machine-wfw-delete-data'
    );

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        filePath: 'docs/readme.md',
        operation: 'delete',
        data: gzipContent('nope'),
      })
    ).rejects.toThrow(/must not include/i);
  });

  test('requestFileWrite rejects blocked upload target paths on create', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-blocked-path',
      'machine-wfw-blocked-path'
    );

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        filePath: '.env',
        operation: 'create',
        data: gzipContent('secret'),
      })
    ).rejects.toThrow(/blocked/i);
  });

  test('requestFileWrite rejects create without data or storageId', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-missing-payload',
      'machine-wfw-missing-payload'
    );

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        filePath: 'docs/readme.md',
        operation: 'create',
      })
    ).rejects.toThrow(/exactly one of data or storageId/i);
  });
});
