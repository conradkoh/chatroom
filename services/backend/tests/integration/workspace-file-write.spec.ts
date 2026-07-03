/**
 * Workspace File Write — Integration Tests
 *
 * Verifies request/fulfill flow for async file writes via daemon.
 */

import { gzipSync } from 'node:zlib';

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

function gzipContent(text: string) {
  return {
    compression: 'gzip' as const,
    content: gzipSync(Buffer.from(text)).toString('base64'),
  };
}

describe('workspace file write requests', () => {
  test('requestFileWrite creates a pending request with validated path', async () => {
    const { sessionId } = await createTestSession('test-wfw-create');
    const machineId = 'machine-wfw-create';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: '/tmp/workspace',
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

  test('requestFileWrite rejects path traversal', async () => {
    const { sessionId } = await createTestSession('test-wfw-traversal');
    const machineId = 'machine-wfw-traversal';
    await registerMachineWithDaemon(sessionId, machineId);

    await expect(
      t.mutation(api.workspaceFiles.requestFileWrite, {
        sessionId,
        machineId,
        workingDir: '/tmp/workspace',
        filePath: '../etc/passwd',
        operation: 'create',
        data: gzipContent('bad'),
      })
    ).rejects.toThrow(/path traversal/i);
  });

  test('requestFileWrite returns pending when same path already has pending request', async () => {
    const { sessionId } = await createTestSession('test-wfw-dedup');
    const machineId = 'machine-wfw-dedup';
    await registerMachineWithDaemon(sessionId, machineId);

    const first = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: '/tmp/workspace',
      filePath: 'notes.md',
      operation: 'create',
      data: gzipContent('v1'),
    });

    const second = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: '/tmp/workspace',
      filePath: 'notes.md',
      operation: 'update',
      data: gzipContent('v2'),
    });

    expect(first.requestId).toBe(second.requestId);
    expect(second.status).toBe('pending');
  });

  test('completeFileWriteRequest sets done and purges cached content', async () => {
    const { sessionId } = await createTestSession('test-wfw-complete');
    const machineId = 'machine-wfw-complete';
    await registerMachineWithDaemon(sessionId, machineId);
    const workingDir = '/tmp/workspace';
    const filePath = 'src/app.ts';

    const { requestId } = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir,
      filePath,
      operation: 'update',
      data: gzipContent('export {}'),
    });

    const cacheId = await t.run(async (ctx) => {
      return ctx.db.insert('chatroom_workspaceFileContentV2', {
        machineId,
        workingDir,
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
    const { sessionId } = await createTestSession('test-wfw-error');
    const machineId = 'machine-wfw-error';
    await registerMachineWithDaemon(sessionId, machineId);

    const { requestId } = await t.mutation(api.workspaceFiles.requestFileWrite, {
      sessionId,
      machineId,
      workingDir: '/tmp/workspace',
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
});
