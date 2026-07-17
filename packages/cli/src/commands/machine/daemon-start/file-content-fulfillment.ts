/**
 * File Content Fulfillment — reads files from disk and uploads to backend.
 *
 * Called periodically by the daemon to fulfill pending file content requests.
 * Similar to git-subscription.ts but simpler — just polls and fulfills.
 */

import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { classifyFileContent, hasKnownBinaryExtension } from './file-content-classifier.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { assertRegisteredWorkingDir } from '../../../infrastructure/services/workspace/assert-registered-working-dir.js';
import { resolvePathWithinWorkspace } from '../../../infrastructure/services/workspace/workspace-path-security.js';
import { isPathContentReadable } from '../../../infrastructure/services/workspace/workspace-visibility-policy.js';

/** Max file content size (500KB). */
const MAX_CONTENT_BYTES = 500 * 1024;

function getErrorCause(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    (error as { cause?: unknown }).cause !== undefined
  ) {
    return (error as { cause: unknown }).cause;
  }
  return error;
}

function isENOENT(error: unknown): boolean {
  const cause = getErrorCause(error);
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function gzipPlainText(text: string): string {
  return gzipSync(Buffer.from(text)).toString('base64');
}

function fulfillGzippedContentEffect(
  session: DaemonSessionServiceShape,
  workingDir: string,
  filePath: string,
  plainText: string,
  truncated: boolean,
  encoding: 'utf8' | 'binary' = 'utf8'
): Effect.Effect<void> {
  const content = gzipPlainText(plainText);
  return Effect.catchAll(
    Effect.tryPromise(() =>
      session.backend.mutation(api.workspaceFiles.fulfillFileContentV2, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        workingDir,
        filePath,
        data: { compression: 'gzip' as const, content },
        encoding,
        truncated,
      })
    ),
    () => Effect.void
  );
}

/** Effect twin for fulfillFileContentRequests — yields DaemonSessionService. */
// fallow-ignore-next-line complexity
export const fulfillFileContentRequestsEffect: Effect.Effect<void, never, DaemonSessionService> =
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    const requests: { _id: string; workingDir: string; filePath: string }[] =
      yield* Effect.catchAll(
        Effect.tryPromise(() =>
          session.backend.query(api.workspaceFiles.getPendingFileContentRequests, {
            sessionId: session.sessionId,
            machineId: session.machineId,
          })
        ),
        () => Effect.succeed([])
      );

    if (requests.length === 0) return;

    console.log(
      `[${formatTimestamp()}] 📥 Received ${requests.length} pending file content request(s): ${requests.map((r) => r.filePath).join(', ')}`
    );

    for (const request of requests) {
      const startTime = Date.now();
      const { workingDir, filePath } = request;

      const registered = yield* Effect.catchAll(
        Effect.tryPromise(() => assertRegisteredWorkingDir(session, workingDir)),
        (): Effect.Effect<{ ok: true } | { ok: false; error: string }> =>
          Effect.succeed({ ok: false, error: 'Workspace check failed' })
      );
      if (!registered.ok) {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Rejected unregistered workspace: ${workingDir} (${registered.error})`
        );
        yield* fulfillGzippedContentEffect(
          session,
          workingDir,
          filePath,
          '[Error: workspace not registered]',
          false
        );
        continue;
      }

      const resolved = yield* Effect.catchAll(
        Effect.tryPromise(() => resolvePathWithinWorkspace(workingDir, filePath)),
        (): Effect.Effect<{ ok: true; absolutePath: string } | { ok: false; error: string }> =>
          Effect.succeed({ ok: false, error: 'Invalid file path' })
      );
      if (!resolved.ok) {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Rejected file path: ${filePath} (${resolved.error})`
        );
        yield* fulfillGzippedContentEffect(
          session,
          workingDir,
          filePath,
          '[Error reading file]',
          false
        );
        continue;
      }

      const absolutePath = resolved.absolutePath;

      if (hasKnownBinaryExtension(filePath)) {
        // Fast path: known binary extensions skip disk read
        yield* fulfillGzippedContentEffect(
          session,
          workingDir,
          filePath,
          '[Binary file]',
          false,
          'binary'
        );
        const elapsed = Date.now() - startTime;
        console.log(
          `[${formatTimestamp()}] 📄 File content synced to Convex: ${filePath} [binary] (${elapsed}ms)`
        );
        continue;
      }

      if (!isPathContentReadable(filePath)) {
        yield* fulfillGzippedContentEffect(
          session,
          workingDir,
          filePath,
          '[File blocked: cannot open sensitive path in remote explorer]',
          false
        );
        const elapsed = Date.now() - startTime;
        console.log(
          `[${formatTimestamp()}] 📄 File content blocked: ${filePath} [secret] (${elapsed}ms)`
        );
        continue;
      }

      let fileNotFound = false;
      const buffer: Buffer = yield* Effect.catchAll(
        Effect.tryPromise(() => readFile(absolutePath)),
        (error): Effect.Effect<Buffer> => {
          if (isENOENT(error)) {
            fileNotFound = true;
            return Effect.succeed(Buffer.alloc(0));
          }
          return Effect.succeed(Buffer.from('[Error reading file]'));
        }
      );

      if (fileNotFound) {
        console.log(
          `[${formatTimestamp()}] ⏳ File not on disk yet, deferring content sync: ${filePath}`
        );
        continue;
      }

      const classification = classifyFileContent(filePath, new Uint8Array(buffer));

      if (classification.kind === 'binary') {
        yield* fulfillGzippedContentEffect(
          session,
          workingDir,
          filePath,
          '[Binary file]',
          false,
          'binary'
        );
        const elapsed = Date.now() - startTime;
        console.log(
          `[${formatTimestamp()}] 📄 File content synced to Convex: ${filePath} [binary] (${elapsed}ms)`
        );
        continue;
      }

      // Text file: decode UTF-8, truncate if needed
      const truncated = buffer.length > MAX_CONTENT_BYTES;
      const slice = truncated ? buffer.subarray(0, MAX_CONTENT_BYTES) : buffer;
      const content = slice.toString('utf8');
      const compressed = gzipSync(Buffer.from(content));
      const contentCompressed = compressed.toString('base64');

      yield* Effect.catchAll(
        Effect.tryPromise(() =>
          session.backend.mutation(api.workspaceFiles.fulfillFileContentV2, {
            sessionId: session.sessionId,
            machineId: session.machineId,
            workingDir,
            filePath,
            data: { compression: 'gzip' as const, content: contentCompressed },
            encoding: 'utf8',
            truncated,
          })
        ),
        () => Effect.void
      );

      const elapsed = Date.now() - startTime;
      console.log(
        `[${formatTimestamp()}] 📄 File content synced to Convex: ${filePath} (${(Buffer.byteLength(content) / 1024).toFixed(1)}KB → ${(compressed.length / 1024).toFixed(1)}KB gzip, ${elapsed}ms)`
      );
    }
  });
