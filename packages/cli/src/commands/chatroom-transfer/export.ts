/**
 * `chatroom export` — read chatrooms through Convex, publish JSON files.
 *
 * The backend owns the read, the consistency check and the build
 * (`runExport`); this module adapts `BackendOps` to the export port,
 * publishes the bytes with `writeExportFileAtomically`, and prints the report.
 *
 * `--chatroom-id` exports one chatroom. `--all` exports every chatroom the caller
 * owns that has an active workspace on this machine, one file each, strictly one
 * after another. A failing chatroom is reported and the run continues.
 *
 * Failures are thrown to the command wrapper in `register.ts`, which renders
 * them as `❌ [CODE] message` and exits 1. The one exception is a per-chatroom
 * failure inside `--all`, which is printed inline so the rest of the run can go on.
 * Success is printed only after the file is linked into place, so a printed path
 * always names a real file.
 */

import { join, resolve } from 'node:path';

import {
  ChatroomTransferError,
  TRANSFER_ERROR_CODES,
  type ExportCategory,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import {
  EXPORT_CATEGORY_ORDER,
  runExport,
  type ChatroomExportPort,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { ChatroomTransferDeps } from './deps.js';
import { exportFileName, prepareDefaultExportsDir, writeExportFileAtomically } from './file-io.js';
import { formatBytes } from './format-bytes.js';
import { requireTransferSession } from './session-guard.js';
import { api } from '../../api.js';
import { getConvexErrorData, getErrorMessage } from '../../utils/convex-error.js';

/** One manifest entry: `count: null` means the exclusion is a policy, not a filtered row count. */
interface Omission {
  count: number | null;
  reason: string;
  /** Set only for attachments, which are counted and measured. */
  bytes?: number;
}

/** The export ships conversation content in plaintext; every run that writes a file says so. */
const PLAINTEXT_WARNING =
  'warning: this file is plaintext and contains conversation content. Keep it private.';

/** Options `chatroom export` accepts. Exactly one of `chatroomId` and `all` must be given. */
export interface ExportOptions {
  chatroomId?: string | undefined;
  all?: boolean | undefined;
  path?: string | undefined;
}

/** What one successful export wrote. Input of the single-chatroom report. */
interface ExportReport {
  chatroomId: string;
  filePath: string;
  counts: ReadonlyMap<ExportCategory, number>;
  omitted: Record<string, Omission>;
}

type ExportTarget = { kind: 'one'; chatroomId: string } | { kind: 'all' };

/**
 * Exports `opts.chatroomId`, or every chatroom the caller owns on this machine
 * when `opts.all` is set, into `<cwd>/.chatroom/exports` (or `opts.path`).
 *
 * The target is checked before any session read or query. Throws when the
 * export is refused or fails; in `--all` mode a per-chatroom failure is printed
 * and the run continues, and the run throws `EXPORT_ALL_INCOMPLETE` at the end
 * if any chatroom failed.
 */
export async function exportChatroom(
  opts: ExportOptions,
  deps: ChatroomTransferDeps
): Promise<void> {
  const target = parseExportTarget(opts);
  const sessionId = await requireTransferSession(deps);
  if (sessionId === null) return;

  if (target.kind === 'all') {
    await exportAll(deps, sessionId, opts.path);
    return;
  }
  printReport(deps.out, await exportOne(deps, sessionId, target.chatroomId, opts.path));
}

/** Decides the target from the flags alone. Throws before any I/O. */
function parseExportTarget(opts: ExportOptions): ExportTarget {
  if (opts.all === true && opts.chatroomId !== undefined) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.EXPORT_TARGET_CONFLICT,
      '--all and --chatroom-id cannot be used together'
    );
  }
  if (opts.all === true) return { kind: 'all' };
  if (opts.chatroomId !== undefined) return { kind: 'one', chatroomId: opts.chatroomId };
  throw new ChatroomTransferError(
    TRANSFER_ERROR_CODES.EXPORT_TARGET_REQUIRED,
    'pass --chatroom-id <id> or --all'
  );
}

/**
 * Exports every chatroom the caller owns on this machine, one at a time.
 * A per-chatroom failure is printed and the loop continues. The summary and
 * warning are printed before the run throws `EXPORT_ALL_INCOMPLETE` on any failure.
 */
async function exportAll(
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

  // The list query is the only read that can fail for the whole run; it throws
  // through the wrapper before any file is written.
  const rooms = (await deps.backend.query(api.chatroomExport.listForMachine, {
    sessionId,
    machineId,
  })) as ExportableChatroom[];
  if (rooms.length === 0) {
    deps.out(`No chatrooms found for machine ${machineId} that you own.`);
    return;
  }

  let exported = 0;
  let failed = 0;
  for (const room of rooms) {
    try {
      const report = await exportOne(deps, sessionId, room.chatroomId, path);
      deps.out(`Exported chatroom ${room.chatroomId} (${room.name ?? 'unnamed'})`);
      deps.out(`  file: ${report.filePath}`);
      exported += 1;
    } catch (error) {
      const formatted = formatTransferError(error);
      deps.err(`❌ [${formatted.code}] ${room.chatroomId}: ${formatted.message}`);
      failed += 1;
    }
  }

  deps.out(`Exported ${exported} of ${rooms.length} chatrooms from machine ${machineId}`);
  if (failed > 0) deps.out(`Failed: ${failed}`);
  if (exported > 0) deps.out(PLAINTEXT_WARNING);
  if (failed > 0) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.EXPORT_ALL_INCOMPLETE,
      `exported ${exported} of ${rooms.length} chatrooms; ${failed} failed`
    );
  }
}

/**
 * Exports one chatroom and publishes its file. Used by both modes; the caller
 * decides how to report the result. Reads the clock once, so the file's
 * `exportedAt` and its name agree.
 */
async function exportOne(
  deps: ChatroomTransferDeps,
  sessionId: SessionId,
  chatroomId: string,
  path: string | undefined
): Promise<ExportReport> {
  const port: ChatroomExportPort = {
    getStamp: (id) =>
      deps.backend.query(api.chatroomExport.getStamp, { sessionId, chatroomId: id }),
    readPage: (args) => deps.backend.query(api.chatroomExport.readPage, { sessionId, ...args }),
  };

  // One clock read feeds both the file's `exportedAt` and its name, so the two
  // never disagree about which second the export belongs to.
  const at = deps.clock();
  const counts = new Map<ExportCategory, number>();
  const { file, json } = await runExport(port, {
    chatroomId,
    cliVersion: deps.version,
    now: () => at,
    onProgress: (category, rows) => counts.set(category, rows),
  });

  const dir = path ? resolve(deps.cwd(), path) : join(deps.cwd(), '.chatroom', 'exports');
  if (!path) await prepareDefaultExportsDir(deps.fs, dir);
  const filePath = await writeExportFileAtomically(
    deps.fs,
    dir,
    exportFileName(chatroomId, at),
    json
  );

  return { chatroomId, filePath, counts, omitted: file.omitted };
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

/** Prints the path, the per-category counts, the omissions and the warning. Single-chatroom mode only. */
function printReport(out: (line: string) => void, report: ExportReport): void {
  out(`Exported chatroom ${report.chatroomId}`);
  out(`  file: ${report.filePath}`);
  out('  counts:');
  for (const category of EXPORT_CATEGORY_ORDER) {
    out(`    ${category}: ${report.counts.get(category) ?? 0}`);
  }
  out('  omitted (not in file):');
  for (const key of Object.keys(report.omitted).sort()) {
    printOmission(out, key, report.omitted[key]);
  }
  printAttachmentLine(out, report.omitted);
  out(PLAINTEXT_WARNING);
}

/** `key: reason` for policy exclusions, `key (n): reason` for counted filters. */
function printOmission(out: (line: string) => void, key: string, omission: Omission): void {
  const count = omission.count === null ? '' : ` (${omission.count})`;
  out(`    ${key}${count}: ${omission.reason}`);
}

/** One plain sentence for the attachment size, only when attachments were left out. */
function printAttachmentLine(out: (line: string) => void, omitted: Record<string, Omission>): void {
  const attachments = omitted.chatroom_fileAttachments;
  if (!attachments?.count) return;
  out(
    `${shownCount(attachments.count)} attachment(s) not included (${formatBytes(attachments.bytes ?? 0)})`
  );
}

/** A capped stamp reports 1001 rows, which means "more than 1000" to the user. */
function shownCount(count: number): string {
  return count > 1000 ? 'more than 1000' : String(count);
}
