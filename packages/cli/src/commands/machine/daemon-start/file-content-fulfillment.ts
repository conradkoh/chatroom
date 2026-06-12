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

import { DaemonSessionService } from './daemon-services.js';
import type { SessionId } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

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

/** Minimal dep type used by Core functions + Effect twins (also used by file-content-subscription.ts). */
export type FulfillFileContentDeps = {
  machineId: string;
  sessionId: SessionId;
  backend: BackendOps;
};

// ── Core implementations (flat deps, no ctx.deps.xxx) ─────────────────────────

/**
 * Poll for pending file content requests and fulfill them.
 * Exported so file-content-subscription.ts can call it directly.
 */
export async function fulfillFileContentRequestsCore(ctx: FulfillFileContentDeps): Promise<void> {
  let requests: { _id: string; workingDir: string; filePath: string }[];
  try {
    requests = await ctx.backend.query(api.workspaceFiles.getPendingFileContentRequests, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    });
  } catch (_err) {
    // Silently skip — will retry on next poll
    return;
  }

  if (requests.length === 0) return;

  console.log(
    `[${formatTimestamp()}] 📥 Received ${requests.length} pending file content request(s): ${requests.map((r) => r.filePath).join(', ')}`
  );

  for (const request of requests) {
    try {
      await fulfillSingleRequestCore(ctx, request);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  File content fulfillment failed for ${request.filePath}: ${getErrorMessage(err)}`
      );
    }
  }
}

async function fulfillSingleRequestCore(
  ctx: FulfillFileContentDeps,
  request: { workingDir: string; filePath: string }
): Promise<void> {
  const startTime = Date.now();
  const { workingDir, filePath } = request;

  // Security: prevent path traversal
  if (filePath.includes('..') || filePath.startsWith('/')) {
    console.warn(`[${formatTimestamp()}] ⚠️  Rejected path traversal attempt: ${filePath}`);
    return;
  }

  const absolutePath = resolve(workingDir, filePath);
  if (!absolutePath.startsWith(resolve(workingDir))) {
    console.warn(`[${formatTimestamp()}] ⚠️  Path escapes workspace: ${absolutePath}`);
    return;
  }

  // Binary file: upload compressed placeholder
  if (isBinaryFile(filePath)) {
    const binaryCompressed = gzipSync(Buffer.from('[Binary file]')).toString('base64');
    await ctx.backend.mutation(api.workspaceFiles.fulfillFileContentV2, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      filePath,
      data: { compression: 'gzip' as const, content: binaryCompressed },
      encoding: 'utf8',
      truncated: false,
    });
    const elapsed = Date.now() - startTime;
    console.log(
      `[${formatTimestamp()}] 📄 File content synced to Convex: ${filePath} [binary] (${elapsed}ms)`
    );
    return;
  }

  // Read file content
  let content: string;
  let truncated = false;

  try {
    const buffer = await readFile(absolutePath);

    if (buffer.length > MAX_CONTENT_BYTES) {
      content = buffer.subarray(0, MAX_CONTENT_BYTES).toString('utf8');
      truncated = true;
    } else {
      content = buffer.toString('utf8');
    }
  } catch (_err) {
    // File not found or permission denied — upload generic error content
    content = '[Error reading file]';
    truncated = false;
  }

  // Compress content for efficient transport
  const compressed = gzipSync(Buffer.from(content));
  const contentCompressed = compressed.toString('base64');

  await ctx.backend.mutation(api.workspaceFiles.fulfillFileContentV2, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    filePath,
    data: { compression: 'gzip' as const, content: contentCompressed },
    encoding: 'utf8',
    truncated,
  });

  const elapsed = Date.now() - startTime;
  console.log(
    `[${formatTimestamp()}] 📄 File content synced to Convex: ${filePath} (${(Buffer.byteLength(content) / 1024).toFixed(1)}KB → ${(compressed.length / 1024).toFixed(1)}KB gzip, ${elapsed}ms)`
  );
}

// ── Effect twin ───────────────────────────────────────────────────────────────

/** Effect twin for fulfillFileContentRequests — yields DaemonSessionService; DaemonSessionServiceShape satisfies FulfillFileContentDeps. */
// fallow-ignore-next-line unused-export
export const fulfillFileContentRequestsEffect: Effect.Effect<void, never, DaemonSessionService> =
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    yield* Effect.promise(() => fulfillFileContentRequestsCore(session));
  });
