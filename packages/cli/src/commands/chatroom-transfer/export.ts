/**
 * `chatroom export` — the current machine's chatrooms, published as ONE bundle file.
 *
 * The backend owns the read, the consistency check and the per-chatroom build (`runExport`); the
 * bundle driver owns the all-or-nothing orchestration (`runExportBundle`). This module lists the
 * machine's chatrooms through `listForMachine`, adapts `BackendOps` to the export port, publishes the
 * bytes with `writeExportFileAtomically`, and prints the summary.
 *
 * The export takes no chatroom selector. Every chatroom the caller owns with an active workspace on
 * this machine goes into `chatroom-all-<machineId>-<stamp>.json`, read strictly one chatroom after
 * another. It is all-or-nothing: a chatroom that fails twice means no file at all, and
 * `EXPORT_ALL_INCOMPLETE` lists every failed chatroom.
 *
 * Failures are thrown to the command wrapper in `register.ts`, which renders them as
 * `❌ [CODE] message` and exits 1. `EXPORT_ALL_INCOMPLETE` additionally prints one
 * `❌ [EXPORT_ALL_INCOMPLETE] <id>: [CODE] message` line per failed chatroom before rethrowing.
 * Success is printed only after the file is linked into place, so a printed path always names a
 * real file.
 */

import { join, resolve } from 'node:path';

import {
  ChatroomTransferError,
  PLAINTEXT_EXPORT_WARNING,
  TRANSFER_ERROR_CODES,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import { bundleFileName } from '@workspace/backend/src/domain/entities/chatroom-transfer-file-name';
import {
  runExportBundle,
  type BundleExportResult,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-bundle';
import type { ChatroomExportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { ChatroomTransferDeps } from './deps.js';
import { prepareDefaultExportsDir, writeExportFileAtomically } from './file-io.js';
import { formatBytes } from './format-bytes.js';
import { requireTransferSession } from './session-guard.js';
import { api } from '../../api.js';
import { getConvexErrorData, getErrorMessage } from '../../utils/convex-error.js';

/** Options `chatroom export` accepts: only the output directory. */
export interface ExportOptions {
  path?: string | undefined;
}

/**
 * Exports every chatroom the caller owns on this machine into one bundle, in `<cwd>/.chatroom/exports`
 * (or `opts.path`). Throws when the export is refused or fails; a failed run writes no file.
 */
export async function exportMachineChatrooms(
  opts: ExportOptions,
  deps: ChatroomTransferDeps
): Promise<void> {
  const sessionId = await requireTransferSession(deps);
  if (sessionId === null) return;
  await exportBundleForThisMachine(deps, sessionId, opts.path);
}

/**
 * Lists the machine's chatrooms, builds the bundle in memory, then publishes it once. A failed run
 * therefore leaves no file and no temp file.
 */
async function exportBundleForThisMachine(
  deps: ChatroomTransferDeps,
  sessionId: SessionId,
  path: string | undefined
): Promise<void> {
  const machineId = await deps.machine.getMachineId();
  if (!machineId) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.EXPORT_NO_MACHINE_IDENTITY,
      'This machine has no identity. Run `chatroom machine daemon start`.'
    );
  }

  const rooms = (await deps.backend.query(api.chatroomExport.listForMachine, {
    sessionId,
    machineId,
  })) as ExportableChatroom[];
  if (rooms.length === 0) {
    deps.out(`No chatrooms found for machine ${machineId} that you own.`);
    return;
  }

  // One clock read feeds the bundle's `exportedAt`, every payload's `exportedAt` and the file name,
  // so all three name the same instant.
  const at = deps.clock();
  const bundle = await buildBundleOrReport(deps, sessionId, machineId, rooms, at);

  const dir = await resolveExportDir(deps, path);
  const filePath = await writeExportFileAtomically(
    deps.fs,
    dir,
    bundleFileName(machineId, at),
    bundle.json
  );
  deps.out(`Exported ${bundle.index.length} chatrooms from machine ${machineId}`);
  deps.out(`  file: ${filePath}`);
  deps.out(`  size: ${formatBytes(new TextEncoder().encode(bundle.json).byteLength)}`);
  printAttachmentLine(deps.out, bundle.omittedAttachments);
  deps.out(PLAINTEXT_EXPORT_WARNING);
}

/**
 * Builds the bundle, printing one line per failed chatroom before the run
 * fails. `EXPORT_ALL_INCOMPLETE` carries the details; every other failure is
 * rethrown untouched for the wrapper to render.
 */
async function buildBundleOrReport(
  deps: ChatroomTransferDeps,
  sessionId: SessionId,
  machineId: string,
  rooms: readonly ExportableChatroom[],
  at: Date
): Promise<BundleExportResult> {
  try {
    return await runExportBundle(makeExportPort(deps, sessionId), {
      chatroomIds: rooms.map((room) => room.chatroomId),
      machineId,
      cliVersion: deps.version,
      now: () => at,
    });
  } catch (error) {
    printIncompleteDetails(deps, error);
    throw error;
  }
}

/** Prints one line per failed chatroom for `EXPORT_ALL_INCOMPLETE`; other failures pass through. */
function printIncompleteDetails(deps: ChatroomTransferDeps, error: unknown): void {
  if (!isIncomplete(error)) return;
  for (const detail of error.details) {
    deps.err(`❌ [${TRANSFER_ERROR_CODES.EXPORT_ALL_INCOMPLETE}] ${detail}`);
  }
}

function isIncomplete(error: unknown): error is ChatroomTransferError {
  return (
    error instanceof ChatroomTransferError &&
    error.code === TRANSFER_ERROR_CODES.EXPORT_ALL_INCOMPLETE
  );
}

/** The port over the Convex export queries. */
function makeExportPort(deps: ChatroomTransferDeps, sessionId: SessionId): ChatroomExportPort {
  return {
    getStamp: (id) =>
      deps.backend.query(api.chatroomExport.getStamp, { sessionId, chatroomId: id }),
    readPage: (args) => deps.backend.query(api.chatroomExport.readPage, { sessionId, ...args }),
  };
}

/**
 * Resolves the output directory. No `--path` means `.chatroom/exports` under
 * cwd, which is created with a `.gitignore`; a `--path` is used as given.
 */
async function resolveExportDir(
  deps: ChatroomTransferDeps,
  path: string | undefined
): Promise<string> {
  if (path) return resolve(deps.cwd(), path);
  const dir = join(deps.cwd(), '.chatroom', 'exports');
  await prepareDefaultExportsDir(deps.fs, dir);
  return dir;
}

/** Maps a thrown value to the CLI's `[CODE] message` pair. */
export function formatTransferError(error: unknown): { code: string; message: string } {
  if (error instanceof ChatroomTransferError) {
    return { code: error.code, message: error.message };
  }
  const data = getConvexErrorData<{ code?: unknown; message?: unknown }>(error);
  return {
    code: asStringOr(data?.code, 'UNKNOWN'),
    message: asStringOr(data?.message, getErrorMessage(error)),
  };
}

/** Keeps the structured string when the payload has one, else the fallback. */
function asStringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** One plain sentence for the attachment size, only when attachments were left out. */
function printAttachmentLine(
  out: (line: string) => void,
  attachments: { count: number; bytes: number }
): void {
  if (!attachments.count) return;
  out(
    `${shownCount(attachments.count)} attachment(s) not included (${formatBytes(attachments.bytes)})`
  );
}

/** A capped stamp reports 1001 rows, which means "more than 1000" to the user. */
function shownCount(count: number): string {
  return count > 1000 ? 'more than 1000' : String(count);
}
