/**
 * File Write Fulfillment — writes files to disk from pending write requests.
 *
 * Subscribed reactively via file-write-subscription.ts (mirrors file-content path).
 */
// fallow-ignore-file code-duplication

import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { computeDirListingContentHash } from '../../../infrastructure/services/workspace/dir-listing-content-hash.js';
import { listDirectory } from '../../../infrastructure/services/workspace/dir-listing-scanner.js';

/** Max file content size (512KB) — matches backend MAX_CONTENT_BYTES. */
const MAX_CONTENT_BYTES = 512 * 1024;

export type PendingFileWriteRequest = {
  _id: string;
  workingDir: string;
  filePath: string;
  operation: 'create' | 'update' | 'delete';
  data?: { compression: 'gzip'; content: string };
};

/** Errors that will not succeed on retry — complete request as terminal error. */
function isTerminalFileWriteError(errorMessage: string): boolean {
  const terminalMessages = new Set([
    'Invalid file path',
    'Path escapes workspace',
    'Missing file data',
    'File content too large',
    'File already exists',
    'File does not exist',
    'Cannot delete workspace root',
  ]);
  return terminalMessages.has(errorMessage);
}

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

function parentDirPath(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

/** Refresh only the parent directory listing after a create/update/delete. */
async function syncParentDirListingAfterWrite(
  session: DaemonSessionServiceShape,
  workingDir: string,
  filePath: string
): Promise<void> {
  const dirPath = parentDirPath(filePath);
  const listing = await listDirectory(workingDir, dirPath);
  const json = JSON.stringify(listing);
  const dataHash = computeDirListingContentHash(listing);
  const compressed = gzipSync(Buffer.from(json)).toString('base64');

  await session.backend.mutation(api.workspaceFiles.syncDirListingV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    dirPath,
    data: { compression: 'gzip' as const, content: compressed },
    dataHash,
    scannedAt: listing.scannedAt,
    truncated: listing.truncated,
    totalCount: listing.totalCount,
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
  if (!request.data) {
    return { ok: false, errorMessage: 'Missing file data' };
  }
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
  if (operation === 'delete' && !exists) {
    return { ok: false, errorMessage: 'File does not exist' };
  }
  return { ok: true };
}

async function writePayloadToDisk(
  absolutePath: string,
  operation: 'create' | 'update',
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
    if (operation === 'delete') {
      if (filePath === '') {
        await completeWriteRequest(session, request._id, {
          status: 'error',
          errorMessage: 'Cannot delete workspace root',
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

      await rm(resolved.absolutePath, { recursive: true, force: false });
      await syncParentDirListingAfterWrite(session, workingDir, filePath);
      await completeWriteRequest(session, request._id, { status: 'done' });

      const elapsed = Date.now() - startTime;
      console.log(`[${formatTimestamp()}] ✏️  File delete fulfilled: ${filePath} (${elapsed}ms)`);
      return;
    }

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
    await syncParentDirListingAfterWrite(session, workingDir, filePath);
    await completeWriteRequest(session, request._id, { status: 'done' });

    const elapsed = Date.now() - startTime;
    console.log(
      `[${formatTimestamp()}] ✏️  File write fulfilled: ${filePath} (${operation}, ${(payload.content.length / 1024).toFixed(1)}KB, ${elapsed}ms)`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Write failed';
    if (isTerminalFileWriteError(message)) {
      await completeWriteRequest(session, request._id, {
        status: 'error',
        errorMessage: message,
      });
      console.warn(`[${formatTimestamp()}] ⚠️  File write failed for ${filePath}: ${message}`);
      return;
    }

    console.warn(
      `[${formatTimestamp()}] ⚠️  File write transient failure for ${filePath}: ${message} (will retry)`
    );
    // Intentionally leave request pending — no completeWriteRequest call
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
