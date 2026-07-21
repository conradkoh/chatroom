/**
 * File Write Fulfillment — writes files to disk from pending write requests.
 *
 * Subscribed reactively via file-write-subscription.ts (mirrors file-content path).
 */
// fallow-ignore-file code-duplication

import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { getBlockedUploadTargetReason } from '@workspace/backend/src/domain/constants/workspace-upload-path-policy.js';
import { MAX_WORKSPACE_UPLOAD_BYTES } from '@workspace/backend/src/domain/constants/workspace-upload.js';
import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { unsupportedFileWriteOperationMessage } from './file-write-errors.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { assertRegisteredWorkingDir } from '../../../infrastructure/services/workspace/assert-registered-working-dir.js';
import {
  gunzipBase64Payload,
  resolvePathWithinWorkspace,
} from '../../../infrastructure/services/workspace/workspace-path-security.js';

/** Max inline gzip payload (512KB) — matches backend MAX_CONTENT_BYTES. */
const MAX_INLINE_CONTENT_BYTES = 512 * 1024;

/** Max storage-backed upload size (70MB) — matches backend MAX_WORKSPACE_UPLOAD_BYTES. */
const MAX_UPLOAD_CONTENT_BYTES = MAX_WORKSPACE_UPLOAD_BYTES;

export type PendingFileWriteRequest = {
  _id: string;
  workingDir: string;
  filePath: string;
  operation: 'create' | 'update' | 'delete' | 'rename' | 'mkdir';
  targetFilePath?: string;
  data?: { compression: 'gzip'; content: string };
  storageId?: string;
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
    'Target path already exists',
    'Target path is required for rename',
    'Rename target must differ from source path',
    'Directory already exists',
    'Workspace not registered for this machine',
    'Cannot upload to this location (.git and sensitive paths are blocked)',
  ]);
  if (errorMessage.startsWith('Unsupported file write operation')) return true;
  return terminalMessages.has(errorMessage);
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
  return gunzipBase64Payload(request.data.content, MAX_INLINE_CONTENT_BYTES);
}

async function fetchStoragePayload(
  session: DaemonSessionServiceShape,
  request: PendingFileWriteRequest
): Promise<{ ok: true; content: Buffer } | { ok: false; errorMessage: string }> {
  const storageUrl = await session.backend.query(api.workspaceFiles.getWriteRequestStorageUrl, {
    sessionId: session.sessionId,
    requestId: request._id as never,
  });

  if (!storageUrl) {
    return { ok: false, errorMessage: 'Missing upload data' };
  }

  const response = await fetch(storageUrl);
  if (!response.ok) {
    return { ok: false, errorMessage: 'Failed to fetch upload' };
  }

  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > MAX_UPLOAD_CONTENT_BYTES) {
    return { ok: false, errorMessage: 'File content too large' };
  }

  return { ok: true, content };
}

async function resolveWritePayload(
  session: DaemonSessionServiceShape,
  request: PendingFileWriteRequest
): Promise<{ ok: true; content: Buffer } | { ok: false; errorMessage: string }> {
  if (request.storageId) {
    return fetchStoragePayload(session, request);
  }
  return decodeWritePayload(request);
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

  const registered = await assertRegisteredWorkingDir(session, workingDir);
  if (!registered.ok) {
    await completeWriteRequest(session, request._id, {
      status: 'error',
      errorMessage: registered.error,
    });
    return;
  }

  const resolved = await resolvePathWithinWorkspace(workingDir, filePath);
  if (!resolved.ok) {
    await completeWriteRequest(session, request._id, {
      status: 'error',
      errorMessage: resolved.error,
    });
    return;
  }

  try {
    if (operation === 'rename') {
      if (!request.targetFilePath) {
        await completeWriteRequest(session, request._id, {
          status: 'error',
          errorMessage: 'Target path is required for rename',
        });
        return;
      }
      if (request.targetFilePath === filePath) {
        await completeWriteRequest(session, request._id, {
          status: 'error',
          errorMessage: 'Rename target must differ from source path',
        });
        return;
      }

      const targetResolved = await resolvePathWithinWorkspace(workingDir, request.targetFilePath);
      if (!targetResolved.ok) {
        await completeWriteRequest(session, request._id, {
          status: 'error',
          errorMessage: targetResolved.error,
        });
        return;
      }

      const sourceExists = await fileExistsAt(resolved.absolutePath);
      if (!sourceExists) {
        await completeWriteRequest(session, request._id, {
          status: 'error',
          errorMessage: 'File does not exist',
        });
        return;
      }

      const targetExists = await fileExistsAt(targetResolved.absolutePath);
      if (targetExists) {
        await completeWriteRequest(session, request._id, {
          status: 'error',
          errorMessage: 'Target path already exists',
        });
        return;
      }

      await mkdir(dirname(targetResolved.absolutePath), { recursive: true });
      await rename(resolved.absolutePath, targetResolved.absolutePath);

      await completeWriteRequest(session, request._id, { status: 'done' });

      const elapsed = Date.now() - startTime;
      console.log(
        `[${formatTimestamp()}] ✏️  File rename fulfilled: ${filePath} → ${request.targetFilePath} (${elapsed}ms)`
      );
      return;
    }

    if (operation === 'mkdir') {
      const exists = await fileExistsAt(resolved.absolutePath);
      if (exists) {
        await completeWriteRequest(session, request._id, {
          status: 'error',
          errorMessage: 'Directory already exists',
        });
        return;
      }

      await mkdir(resolved.absolutePath, { recursive: true });
      await completeWriteRequest(session, request._id, { status: 'done' });

      const elapsed = Date.now() - startTime;
      console.log(
        `[${formatTimestamp()}] ✏️  Directory mkdir fulfilled: ${filePath} (${elapsed}ms)`
      );
      return;
    }

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
      await completeWriteRequest(session, request._id, { status: 'done' });

      const elapsed = Date.now() - startTime;
      console.log(`[${formatTimestamp()}] ✏️  File delete fulfilled: ${filePath} (${elapsed}ms)`);
      return;
    }

    if (operation !== 'create' && operation !== 'update') {
      await completeWriteRequest(session, request._id, {
        status: 'error',
        errorMessage: unsupportedFileWriteOperationMessage(operation),
      });
      return;
    }

    if (operation === 'create') {
      const blockedReason = getBlockedUploadTargetReason(filePath);
      if (blockedReason) {
        await completeWriteRequest(session, request._id, {
          status: 'error',
          errorMessage: blockedReason,
        });
        return;
      }
    }

    const payload = await resolveWritePayload(session, request);
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
