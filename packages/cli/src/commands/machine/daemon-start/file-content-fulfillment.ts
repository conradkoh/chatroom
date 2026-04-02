/**
 * File Content Fulfillment — reads files from disk and uploads to backend.
 *
 * Called periodically by the daemon to fulfill pending file content requests.
 * Similar to git-subscription.ts but simpler — just polls and fulfills.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Max file content size (500KB). */
const MAX_CONTENT_BYTES = 500 * 1024;

/** Known binary file extensions. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.exe', '.dll', '.so', '.dylib',
  '.bin', '.dat', '.db', '.sqlite',
]);

function isBinaryFile(path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

/**
 * Poll for pending file content requests and fulfill them.
 */
export async function fulfillFileContentRequests(ctx: DaemonContext): Promise<void> {
  let requests: Array<{ _id: string; workingDir: string; filePath: string }>;
  try {
    requests = await ctx.deps.backend.query(api.workspaceFiles.getPendingFileContentRequests, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    });
  } catch (err) {
    // Silently skip — will retry on next poll
    return;
  }

  if (requests.length === 0) return;

  console.log(
    `[${formatTimestamp()}] 📥 Received ${requests.length} pending file content request(s): ${requests.map((r) => r.filePath).join(', ')}`
  );

  for (const request of requests) {
    try {
      await fulfillSingleRequest(ctx, request);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  File content fulfillment failed for ${request.filePath}: ${getErrorMessage(err)}`
      );
    }
  }
}

async function fulfillSingleRequest(
  ctx: DaemonContext,
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

  // Binary file: upload empty content with truncated flag
  if (isBinaryFile(filePath)) {
    await ctx.deps.backend.mutation(api.workspaceFiles.fulfillFileContent, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      workingDir,
      filePath,
      content: '[Binary file]',
      encoding: 'utf8',
      truncated: false,
    });
    const elapsed = Date.now() - startTime;
    console.log(`[${formatTimestamp()}] 📄 File content synced to Convex: ${filePath} [binary] (${elapsed}ms)`);
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
  } catch (err) {
    // File not found or permission denied — upload error content
    content = `[Error reading file: ${getErrorMessage(err)}]`;
    truncated = false;
  }

  await ctx.deps.backend.mutation(api.workspaceFiles.fulfillFileContent, {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    workingDir,
    filePath,
    content,
    encoding: 'utf8',
    truncated,
  });

  const elapsed = Date.now() - startTime;
  console.log(`[${formatTimestamp()}] 📄 File content synced to Convex: ${filePath} (${elapsed}ms)`);
}
