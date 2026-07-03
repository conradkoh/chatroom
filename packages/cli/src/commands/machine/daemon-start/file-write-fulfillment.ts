/**
 * File Write Fulfillment — writes files to disk from pending write requests.
 *
 * Subscribed reactively via file-write-subscription.ts (mirrors file-content path).
 */
// fallow-ignore-file code-duplication

import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { scanFileTree } from '../../../infrastructure/services/workspace/file-tree-scanner.js';

/** Max file content size (512KB) — matches backend MAX_CONTENT_BYTES. */
const MAX_CONTENT_BYTES = 512 * 1024;

export type PendingFileWriteRequest = {
  _id: string;
  workingDir: string;
  filePath: string;
  operation: 'create' | 'update';
  data: { compression: 'gzip'; content: string };
};

/** Reject path traversal and paths that escape the workspace root. */
function resolveWorkspaceWritePath(
  workingDir: string,
  filePath: string
): { ok: true; absolutePath: string } | { ok: false; error: string } {
  if (filePath.includes('..') || filePath.startsWith('/')) {
    return { ok: false, error: 'Invalid file path' };
  }

  const absolutePath = resolve(workingDir, filePath);
  const workspaceRoot = resolve(workingDir);
  if (!absolutePath.startsWith(workspaceRoot)) {
    return { ok: false, error: 'Path escapes workspace' };
  }

  return { ok: true, absolutePath };
}

async function syncFileTreeAfterWrite(
  session: DaemonSessionServiceShape,
  workingDir: string
): Promise<void> {
  const tree = await scanFileTree(workingDir);
  const treeJson = JSON.stringify(tree);
  const treeHash = createHash('md5').update(treeJson).digest('hex');
  const compressed = gzipSync(Buffer.from(treeJson));
  const treeJsonCompressed = compressed.toString('base64');

  await session.backend.mutation(api.workspaceFiles.syncFileTreeV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    data: { compression: 'gzip' as const, content: treeJsonCompressed },
    dataHash: treeHash,
    scannedAt: tree.scannedAt,
  });
}

async function completeWriteRequest(
  session: DaemonSessionServiceShape,
  requestId: string,
  result: { status: 'done' } | { status: 'error'; errorMessage: string }
): Promise<void> {
  await session.backend.mutation(api.workspaceFiles.completeFileWriteRequest, {
    sessionId: session.sessionId,
    requestId: requestId as never,
    status: result.status,
    errorMessage: result.status === 'error' ? result.errorMessage : undefined,
  });
}

async function fileExistsAt(absolutePath: string): Promise<boolean> {
  return access(absolutePath)
    .then(() => true)
    .catch(() => false);
}

function decodeWritePayload(
  request: PendingFileWriteRequest
): { ok: true; content: Buffer } | { ok: false; errorMessage: string } {
  const content = gunzipSync(Buffer.from(request.data.content, 'base64'));
  if (content.length > MAX_CONTENT_BYTES) {
    return { ok: false, errorMessage: 'File content too large' };
  }
  return { ok: true, content };
}

// fallow-ignore-next-line complexity
async function validateWriteOperation(
  operation: PendingFileWriteRequest['operation'],
  absolutePath: string
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  const exists = await fileExistsAt(absolutePath);
  if (operation === 'create' && exists) {
    return { ok: false, errorMessage: 'File already exists' };
  }
  if (operation === 'update' && !exists) {
    return { ok: false, errorMessage: 'File does not exist' };
  }
  return { ok: true };
}

async function writePayloadToDisk(
  absolutePath: string,
  operation: PendingFileWriteRequest['operation'],
  content: Buffer
): Promise<void> {
  if (operation === 'create') {
    await mkdir(dirname(absolutePath), { recursive: true });
  }
  await writeFile(absolutePath, content);
}

// fallow-ignore-next-line complexity
async function fulfillOneFileWriteRequest(
  session: DaemonSessionServiceShape,
  request: PendingFileWriteRequest
): Promise<void> {
  const startTime = Date.now();
  const { workingDir, filePath, operation } = request;

  const resolved = resolveWorkspaceWritePath(workingDir, filePath);
  if (!resolved.ok) {
    await completeWriteRequest(session, request._id, {
      status: 'error',
      errorMessage: resolved.error,
    });
    return;
  }

  try {
    const payload = decodeWritePayload(request);
    if (!payload.ok) {
      await completeWriteRequest(session, request._id, {
        status: 'error',
        errorMessage: payload.errorMessage,
      });
      return;
    }

    const operationCheck = await validateWriteOperation(operation, resolved.absolutePath);
    if (!operationCheck.ok) {
      await completeWriteRequest(session, request._id, {
        status: 'error',
        errorMessage: operationCheck.errorMessage,
      });
      return;
    }

    await writePayloadToDisk(resolved.absolutePath, operation, payload.content);
    await syncFileTreeAfterWrite(session, workingDir);
    await completeWriteRequest(session, request._id, { status: 'done' });

    const elapsed = Date.now() - startTime;
    console.log(
      `[${formatTimestamp()}] ✏️  File write fulfilled: ${filePath} (${operation}, ${(payload.content.length / 1024).toFixed(1)}KB, ${elapsed}ms)`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Write failed';
    await completeWriteRequest(session, request._id, {
      status: 'error',
      errorMessage: message,
    });
    console.warn(`[${formatTimestamp()}] ⚠️  File write failed for ${filePath}: ${message}`);
  }
}

/** Effect twin — queries pending write requests and fulfills each on disk. */
export const fulfillFileWriteRequestsEffect: Effect.Effect<void, never, DaemonSessionService> =
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    const requests: PendingFileWriteRequest[] = yield* Effect.catchAll(
      Effect.tryPromise(() =>
        session.backend.query(api.workspaceFiles.getPendingFileWriteRequests, {
          sessionId: session.sessionId,
          machineId: session.machineId,
        })
      ),
      () => Effect.succeed([])
    );

    if (requests.length === 0) return;

    console.log(
      `[${formatTimestamp()}] ✏️  Received ${requests.length} pending file write request(s): ${requests.map((r) => r.filePath).join(', ')}`
    );

    for (const request of requests) {
      yield* Effect.catchAll(
        Effect.tryPromise(() => fulfillOneFileWriteRequest(session, request)),
        () => Effect.void
      );
    }
  });
