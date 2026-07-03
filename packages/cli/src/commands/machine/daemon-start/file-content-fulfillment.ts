/**
 * File Content Fulfillment — reads files from disk and uploads to backend.
 *
 * Called periodically by the daemon to fulfill pending file content requests.
 * Similar to git-subscription.ts but simpler — just polls and fulfills.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { isPathContentReadable } from '../../../infrastructure/services/workspace/workspace-visibility-policy.js';

/** Max file content size (500KB). */
const MAX_CONTENT_BYTES = 500 * 1024;

/** Known binary file extensions. */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
]);

function isBinaryFile(path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

function gzipPlainText(text: string): string {
  return gzipSync(Buffer.from(text)).toString('base64');
}

function fulfillGzippedContentEffect(
  session: DaemonSessionServiceShape,
  workingDir: string,
  filePath: string,
  plainText: string,
  truncated: boolean
): Effect.Effect<void> {
  return Effect.catchAll(
    Effect.tryPromise(() =>
      session.backend.mutation(api.workspaceFiles.fulfillFileContentV2, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        workingDir,
        filePath,
        data: { compression: 'gzip' as const, content: gzipPlainText(plainText) },
        encoding: 'utf8',
        truncated,
      })
    ),
    () => Effect.void
  );
}

/** Effect twin for fulfillFileContentRequests — yields DaemonSessionService. */
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

      if (filePath.includes('..') || filePath.startsWith('/')) {
        console.warn(`[${formatTimestamp()}] ⚠️  Rejected path traversal attempt: ${filePath}`);
        continue;
      }

      const absolutePath = resolve(workingDir, filePath);
      if (!absolutePath.startsWith(resolve(workingDir))) {
        console.warn(`[${formatTimestamp()}] ⚠️  Path escapes workspace: ${absolutePath}`);
        continue;
      }

      if (isBinaryFile(filePath)) {
        yield* fulfillGzippedContentEffect(session, workingDir, filePath, '[Binary file]', false);
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

      const { content, truncated } = yield* Effect.catchAll(
        Effect.tryPromise(() => readFile(absolutePath)).pipe(
          Effect.map((buffer) => {
            if (buffer.length > MAX_CONTENT_BYTES) {
              return {
                content: buffer.subarray(0, MAX_CONTENT_BYTES).toString('utf8'),
                truncated: true,
              };
            }
            return { content: buffer.toString('utf8'), truncated: false };
          })
        ),
        () => Effect.succeed({ content: '[Error reading file]', truncated: false })
      );

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
