import zlib from 'node:zlib';
import type { FileDeps } from './deps.js';
import { api } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import { formatError, formatAuthError } from '../../utils/error-formatting.js';
import { parseFileReference, decodeWorkspaceId } from '../../utils/fileReference.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { FileDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FileViewOptions {
  fileReference: string;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<FileDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

// ─── Polling Helpers ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Commands ──────────────────────────────────────────────────────────────

/**
 * View a file referenced in a chatroom message.
 *
 * Parses a `{file://workspaceId/path}` reference, requests the file content
 * from the workspace daemon, polls for the result, decompresses, and prints.
 */
export async function viewFile(options: FileViewOptions, deps?: FileDeps) {
  const d = deps ?? (await createDefaultDeps());

  // ── Auth ────────────────────────────────────────────────────────────────
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    formatAuthError(d.session.getConvexUrl(), d.session.getOtherSessionUrls());
    process.exit(1);
    return;
  }

  // ── Parse file reference ────────────────────────────────────────────────
  const parsed = parseFileReference(options.fileReference);
  if (!parsed) {
    formatError('Invalid file reference format', [
      `Got: ${options.fileReference}`,
      'Expected: {file://workspaceId/path}',
      'Example: chatroom file view --file-reference="{file://abc123/src/index.ts}"',
    ]);
    process.exit(1);
    return;
  }

  // ── Decode workspace ID ─────────────────────────────────────────────────
  let machineId: string;
  let workingDir: string;
  try {
    const decoded = decodeWorkspaceId(parsed.workspaceId);
    machineId = decoded.machineId;
    workingDir = decoded.workingDir;
  } catch (err) {
    formatError('Failed to decode workspace ID', [
      `Workspace ID: ${parsed.workspaceId}`,
      (err as Error).message,
    ]);
    process.exit(1);
    return;
  }

  const filePath = parsed.filePath;

  // ── Request file content ────────────────────────────────────────────────
  let requestStatus: { status: 'cached' | 'pending' | 'requested' };
  try {
    requestStatus = await d.backend.mutation(api.workspaceFiles.requestFileContent, {
      sessionId,
      machineId,
      workingDir,
      filePath,
    });
  } catch (error) {
    formatError('Failed to request file content', [
      `File: ${filePath}`,
      `Workspace: ${workingDir}`,
      String(error),
    ]);
    process.exit(1);
    return;
  }

  // ── Poll for content ────────────────────────────────────────────────────
  const INITIAL_WAIT_MS = 200;
  const POLL_INTERVAL_MS = 500;
  const TIMEOUT_MS = 15_000;

  const queryArgs = { sessionId, machineId, workingDir, filePath };

  // If cached, content should already be available — still query it
  if (requestStatus.status !== 'cached') {
    await sleep(INITIAL_WAIT_MS);
  }

  const startTime = Date.now();
  let content: {
    data: string;
    encoding: string;
    truncated: boolean;
    fetchedAt: number;
  } | null = null;

  while (Date.now() - startTime < TIMEOUT_MS) {
    try {
      content = await d.backend.query(api.workspaceFiles.getFileContentV2, queryArgs);
    } catch (error) {
      formatError('Failed to fetch file content', [String(error)]);
      process.exit(1);
      return;
    }

    if (content) break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (!content) {
    formatError('Timed out waiting for file content', [
      `File: ${filePath}`,
      `Workspace: ${workingDir}`,
      'The workspace daemon may be offline or the file may not exist.',
      `Timeout: ${TIMEOUT_MS / 1000}s`,
    ]);
    process.exit(1);
    return;
  }

  // ── Decompress and display ──────────────────────────────────────────────
  let fileContent: string;
  try {
    fileContent = zlib.gunzipSync(Buffer.from(content.data, 'base64')).toString('utf-8');
  } catch (err) {
    formatError('Failed to decompress file content', [`File: ${filePath}`, (err as Error).message]);
    process.exit(1);
    return;
  }

  if (!fileContent || fileContent.trim().length === 0) {
    formatError('File content is empty', [`File: ${filePath}`, `Workspace: ${workingDir}`]);
    process.exit(1);
    return;
  }

  const separator = '\u2500'.repeat(41);
  console.log(`\uD83D\uDCC2 File: ${filePath}`);
  console.log(`\uD83D\uDCCD Workspace: ${workingDir}`);
  if (content.truncated) {
    console.log('\u26A0\uFE0F  Content was truncated (file too large)');
  }
  console.log(separator);
  console.log(fileContent);
  console.log(separator);
}
