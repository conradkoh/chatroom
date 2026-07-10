/**
 * File Write Fulfillment — unit tests
 */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import { unsupportedFileWriteOperationMessage } from './file-write-errors.js';
import { fulfillFileWriteRequestsEffect } from './file-write-fulfillment.js';
import { createMockDaemonSessionInit } from './testing/index.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      getPendingFileWriteRequests: 'mock-getPendingFileWriteRequests',
      completeFileWriteRequest: 'mock-completeFileWriteRequest',
    },
  },
}));

function makeRequest(
  workingDir: string,
  filePath: string,
  operation: 'create' | 'update' | 'delete' | 'rename' | 'mkdir',
  content?: string,
  requestId = 'req-1',
  targetFilePath?: string
) {
  return {
    _id: requestId,
    workingDir,
    filePath,
    operation,
    ...(operation === 'rename' ? { targetFilePath } : {}),
    ...(operation === 'delete' || operation === 'rename' || operation === 'mkdir'
      ? {}
      : {
          data: {
            compression: 'gzip' as const,
            content: gzipSync(Buffer.from(content ?? '')).toString('base64'),
          },
        }),
  };
}

type FulfillmentRequest = ReturnType<typeof makeRequest>;

async function runFulfillment(requests: FulfillmentRequest[]) {
  const workingDir = requests[0]?.workingDir ?? '';
  const init = createMockDaemonSessionInit({
    machineId: 'machine-write-test',
    workspaceListStore: {
      workspaces: [{ workingDir }],
      updatedAt: Date.now(),
    },
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(requests),
    },
  });

  await Effect.runPromise(
    fulfillFileWriteRequestsEffect.pipe(Effect.provide(daemonSessionToLayers(init)))
  );

  return init.backend;
}

describe('fulfillFileWriteRequestsEffect', () => {
  let workingDir: string;

  beforeEach(async () => {
    workingDir = await mkdtemp(join(tmpdir(), 'chatroom-write-test-'));
  });

  afterEach(async () => {
    await rm(workingDir, { recursive: true, force: true });
  });

  it('create writes a new file and creates parent directories', async () => {
    const backend = await runFulfillment([
      makeRequest(workingDir, 'nested/new-file.md', 'create', '# Hello'),
    ]);

    const content = await readFile(join(workingDir, 'nested/new-file.md'), 'utf8');
    expect(content).toBe('# Hello');
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'done' })
    );
  });

  it('update overwrites an existing file', async () => {
    const filePath = 'existing.md';
    await writeFile(join(workingDir, filePath), 'old');

    await runFulfillment([makeRequest(workingDir, filePath, 'update', 'new content')]);

    const content = await readFile(join(workingDir, filePath), 'utf8');
    expect(content).toBe('new content');
  });

  it('create-on-existing reports error', async () => {
    const filePath = 'duplicate.md';
    await writeFile(join(workingDir, filePath), 'already here');

    const backend = await runFulfillment([makeRequest(workingDir, filePath, 'create', 'new')]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'error',
        errorMessage: 'File already exists',
      })
    );
  });

  it('update-on-missing reports error', async () => {
    const backend = await runFulfillment([
      makeRequest(workingDir, 'missing.md', 'update', 'content'),
    ]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'error',
        errorMessage: 'File does not exist',
      })
    );
  });

  it('rejects path traversal without writing', async () => {
    const backend = await runFulfillment([
      makeRequest(workingDir, '../escape.md', 'create', 'bad'),
    ]);

    await expect(access(join(workingDir, '../escape.md'))).rejects.toThrow();
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'error' })
    );
  });

  it('delete removes an existing file', async () => {
    const filePath = 'notes.md';
    const absolutePath = join(workingDir, filePath);
    await writeFile(absolutePath, '# hello');

    const backend = await runFulfillment([
      {
        _id: 'req-del-1',
        workingDir,
        filePath,
        operation: 'delete',
      },
    ]);

    await expect(access(absolutePath)).rejects.toThrow();
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'done' })
    );
  });

  it('delete removes a non-empty directory recursively', async () => {
    const dirPath = 'docs';
    await mkdir(join(workingDir, dirPath), { recursive: true });
    await writeFile(join(workingDir, dirPath, 'readme.md'), '# hi');

    const backend = await runFulfillment([
      {
        _id: 'req-del-dir',
        workingDir,
        filePath: dirPath,
        operation: 'delete',
      },
    ]);

    await expect(access(join(workingDir, dirPath))).rejects.toThrow();
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'done' })
    );
  });

  it('delete rejects empty path (workspace root)', async () => {
    const backend = await runFulfillment([
      {
        _id: 'req-del-root',
        workingDir,
        filePath: '',
        operation: 'delete',
      },
    ]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Cannot delete workspace root',
      })
    );
  });

  it('delete errors when file does not exist', async () => {
    const backend = await runFulfillment([
      {
        _id: 'req-del-missing',
        workingDir,
        filePath: 'missing.md',
        operation: 'delete',
      },
    ]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'error',
        errorMessage: 'File does not exist',
      })
    );
  });

  it('completes without error when no pending requests exist', async () => {
    const init = createMockDaemonSessionInit({
      backend: {
        mutation: vi.fn(),
        query: vi.fn().mockResolvedValue([]),
      },
    });

    await expect(
      Effect.runPromise(
        fulfillFileWriteRequestsEffect.pipe(Effect.provide(daemonSessionToLayers(init)))
      )
    ).resolves.toBeUndefined();
  });

  it('still completes terminal validation errors immediately', async () => {
    const filePath = 'terminal-duplicate.md';
    await writeFile(join(workingDir, filePath), 'already here');

    const backend = await runFulfillment([makeRequest(workingDir, filePath, 'create', 'new')]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'error',
        errorMessage: 'File already exists',
      })
    );
  });

  it('rename moves a file to a new basename in the same directory', async () => {
    await writeFile(join(workingDir, 'old.txt'), 'hello');

    const backend = await runFulfillment([
      makeRequest(workingDir, 'old.txt', 'rename', undefined, 'req-rename-1', 'new.txt'),
    ]);

    expect(await readFile(join(workingDir, 'new.txt'), 'utf8')).toBe('hello');
    await expect(access(join(workingDir, 'old.txt'))).rejects.toThrow();
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'done' })
    );
  });

  it('rename moves a directory', async () => {
    await mkdir(join(workingDir, 'old-dir'));
    await writeFile(join(workingDir, 'old-dir', 'child.txt'), 'x');

    const backend = await runFulfillment([
      makeRequest(workingDir, 'old-dir', 'rename', undefined, 'req-rename-2', 'new-dir'),
    ]);

    expect(await readFile(join(workingDir, 'new-dir', 'child.txt'), 'utf8')).toBe('x');
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'done' })
    );
  });

  it('rename errors when target already exists', async () => {
    await writeFile(join(workingDir, 'a.txt'), 'a');
    await writeFile(join(workingDir, 'b.txt'), 'b');

    const backend = await runFulfillment([
      makeRequest(workingDir, 'a.txt', 'rename', undefined, 'req-rename-3', 'b.txt'),
    ]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Target path already exists',
      })
    );
  });

  it('mkdir creates a directory at workspace root', async () => {
    const backend = await runFulfillment([makeRequest(workingDir, 'docs', 'mkdir')]);

    await expect(access(join(workingDir, 'docs'))).resolves.toBeUndefined();
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'done' })
    );
  });

  it('mkdir creates a nested directory under a parent', async () => {
    await mkdir(join(workingDir, 'src'));

    const backend = await runFulfillment([makeRequest(workingDir, 'src/components', 'mkdir')]);

    await expect(access(join(workingDir, 'src/components'))).resolves.toBeUndefined();
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'done' })
    );
  });

  it('mkdir errors when directory already exists', async () => {
    await mkdir(join(workingDir, 'docs'));

    const backend = await runFulfillment([makeRequest(workingDir, 'docs', 'mkdir')]);

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Directory already exists',
      })
    );
  });

  it('rejects unregistered workingDir before touching disk', async () => {
    const init = createMockDaemonSessionInit({
      machineId: 'machine-write-test',
      workspaceListStore: { workspaces: [], updatedAt: Date.now() },
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([makeRequest(workingDir, 'notes.md', 'create', 'hi')]),
      },
    });

    await Effect.runPromise(
      fulfillFileWriteRequestsEffect.pipe(Effect.provide(daemonSessionToLayers(init)))
    );

    expect(init.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Workspace not registered for this machine',
      })
    );
    await expect(access(join(workingDir, 'notes.md'))).rejects.toThrow();
  });
});

describe('unsupportedFileWriteOperationMessage', () => {
  it('names the operation and mentions upgrading the CLI', () => {
    const msg = unsupportedFileWriteOperationMessage('mkdir');
    expect(msg).toContain('mkdir');
    expect(msg).toContain('upgrade');
    expect(msg).toContain('chatroom-cli');
  });
});
