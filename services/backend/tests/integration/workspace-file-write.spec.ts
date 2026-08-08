/**
 * Workspace File Write — Integration Tests
 *
 * Verifies request/fulfill flow for async file writes via daemon.
 */

import { gzipSync } from 'node:zlib';

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildChatAttachmentUploadPath } from '../../src/domain/constants/chat-attachment-upload-path';
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

async function claimWriteRequest(
  sessionId: string,
  requestId: Id<'chatroom_workspaceFileWriteRequests'>,
  expectedRevision = 1
) {
  return t.mutation(api.workspaceFiles.claimFileWriteRequest, {
    sessionId,
    requestId,
    expectedRevision,
  });
}

async function completeWriteRequest(
  sessionId: string,
  requestId: Id<'chatroom_workspaceFileWriteRequests'>,
  revision = 1,
  status: 'done' | 'error' = 'done',
  errorMessage?: string
) {
  await claimWriteRequest(sessionId, requestId, revision);
  await t.mutation(api.workspaceFiles.completeFileWriteRequest, {
    sessionId,
    requestId,
    revision,
    status,
    errorMessage,
  });
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

  test('requestFileWrite supersedes pending create with delete on same path', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-supersede-inline',
      'machine-wfw-supersede-inline'
    );

    const first = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'docs/supersede.md',
      operation: 'create',
      data: gzipContent('# v1'),
    });
    expect(first.status).toBe('requested');

    const second = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'docs/supersede.md',
      operation: 'delete',
    });

    expect(second.status).toBe('requested');
    expect(second.requestId).toBe(first.requestId);

    const pending = await t.query(api.workspaceFiles.getPendingFileWriteRequests, {
      sessionId,
      machineId,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.filePath).toBe('docs/supersede.md');
    expect(pending[0]?.operation).toBe('delete');
    expect(pending[0]?.data).toBeUndefined();
  });

  test('completeFileWriteRequest sets done and upserts v2 cache for create/update', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-complete',
      'machine-wfw-complete'
    );
    const filePath = 'src/app.ts';
    const writeData = gzipContent('export const x = 1;');

    const { requestId } = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath,
      operation: 'update',
      data: writeData,
    });

    await completeWriteRequest(sessionId, requestId);

    const request = await t.query(api.workspaceFiles.getFileWriteRequest, {
      sessionId,
      requestId,
    });
    expect(request?.status).toBe('done');

    // v2 cache should be populated with write payload, not deleted
    const cached = await t.query(api.workspaceFiles.getFileContentV2, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath,
    });
    expect(cached).not.toBeNull();
    expect(cached?.data).toEqual(writeData);
  });

  test('completeFileWriteRequest deletes v2 cache for delete operation', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-delete-cache',
      'machine-wfw-delete-cache'
    );
    const filePath = 'to-delete.ts';

    const { requestId: createRequestId } = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath,
      operation: 'create',
      data: gzipContent('delete me'),
    });

    await completeWriteRequest(sessionId, createRequestId);

    const { requestId: deleteRequestId } = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath,
      operation: 'delete',
    });

    await completeWriteRequest(sessionId, deleteRequestId);

    const cached = await t.query(api.workspaceFiles.getFileContentV2, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath,
    });
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

    await completeWriteRequest(sessionId, requestId, 1, 'error', 'File does not exist');

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

  test('requestFileWrite allows inline create to sensitive paths', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-inline-sensitive',
      'machine-wfw-inline-sensitive'
    );

    const result = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'packages/app/.env.local',
      operation: 'create',
      data: gzipContent('secret'),
    });

    expect(result.status).toBe('requested');
  });

  test('requestFileWrite rejects blocked storage-backed upload paths', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-blocked-storage-path',
      'machine-wfw-blocked-storage-path'
    );

    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(['secret'])));

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        filePath: '.env',
        operation: 'create',
        storageId,
      })
    ).rejects.toThrow(/blocked/i);
  });

  test('stale revision cannot complete after superseding request while processing', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-stale-revision',
      'machine-wfw-stale-revision'
    );

    const first = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'docs/race.md',
      operation: 'create',
      data: gzipContent('# v1'),
    });

    const claim = await claimWriteRequest(sessionId, first.requestId, 1);
    expect(claim.status).toBe('claimed');

    const second = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      filePath: 'docs/race.md',
      operation: 'delete',
    });
    expect(second.requestId).not.toBe(first.requestId);

    await expect(
      t.mutation(api.workspaceFiles.completeFileWriteRequest, {
        sessionId,
        requestId: first.requestId,
        revision: 1,
        status: 'done',
      })
    ).rejects.toThrow(/stale/i);
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

  test('requestFileWrite validates chat attachment uploadKind path before storage', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-chat-attachment-ok',
      'machine-wfw-chat-attachment-ok'
    );

    const filePath = buildChatAttachmentUploadPath(
      'notes.md',
      'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
    );

    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(['hello'])));

    let caught: unknown;
    try {
      await t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        filePath,
        operation: 'create',
        storageId,
        uploadKind: 'chatAttachment',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).not.toMatch(/Invalid attachment path/i);
  });

  test('requestFileWrite rejects chat attachment with wrong prefix', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-chat-attachment-prefix',
      'machine-wfw-chat-attachment-prefix'
    );

    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(['hello'])));

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        filePath: 'docs/notes.md',
        operation: 'create',
        storageId,
        uploadKind: 'chatAttachment',
      })
    ).rejects.toThrow(/Invalid attachment path/i);
  });

  test('requestFileWrite rejects malformed path under attachments dir without uploadKind', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-wfw-chat-attachment-defense',
      'machine-wfw-chat-attachment-defense'
    );

    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(['hello'])));

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: WORKING_DIR,
        filePath: '.chatroom/downloads/attachments/files/not-a-valid-path.txt',
        operation: 'create',
        storageId,
      })
    ).rejects.toThrow(/Invalid attachment path/i);
  });
});
