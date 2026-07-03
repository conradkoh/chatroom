/**
 * File Write Fulfillment — unit tests
 */

import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import { fulfillFileWriteRequestsEffect } from './file-write-fulfillment.js';
import { createMockDaemonSessionInit } from './testing/index.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      getPendingFileWriteRequests: 'mock-getPendingFileWriteRequests',
      completeFileWriteRequest: 'mock-completeFileWriteRequest',
      syncFileTreeV2: 'mock-syncFileTreeV2',
    },
  },
}));

vi.mock('../../../infrastructure/services/workspace/file-tree-scanner.js', () => ({
  scanFileTree: vi.fn().mockResolvedValue({
    entries: [],
    scannedAt: Date.now(),
  }),
}));

function makeRequest(
  workingDir: string,
  filePath: string,
  operation: 'create' | 'update' | 'delete',
  content?: string,
  requestId = 'req-1'
) {
  return {
    _id: requestId,
    workingDir,
    filePath,
    operation,
    ...(operation === 'delete'
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
  const init = createMockDaemonSessionInit({
    machineId: 'machine-write-test',
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
});
