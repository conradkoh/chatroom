/**
 * `chatroom export` — read chatrooms through Convex, publish JSON.
 *
 * The backend owns the read, the consistency check and the build
 * (`runExport`); the bundle driver owns the `--all` orchestration
 * (`runExportBundle`). This module adapts `BackendOps` to the export port,
 * publishes the bytes with `writeExportFileAtomically`, and prints the report.
 *
 * `--chatroom-id` exports one chatroom to one file. `--all` exports every
 * chatroom the caller owns on this machine into ONE
 * `chatroom-all-<machineId>-<stamp>.json` bundle, strictly one chatroom after
 * another. `--all` is all-or-nothing: a chatroom that fails twice means no file
 * at all, and `EXPORT_ALL_INCOMPLETE` lists every failed chatroom.
 *
 * Failures are thrown to the command wrapper in `register.ts`, which renders
 * them as `❌ [CODE] message` and exits 1. `--all` additionally prints one
 * `❌ [EXPORT_ALL_INCOMPLETE] <id>: [CODE] message` line per failed chatroom
 * before rethrowing, because the summary alone does not name them. Success is
 * printed only after the file is linked into place, so a printed path always
 * names a real file.
 */

import { join, resolve } from 'node:path';

import {
  ChatroomTransferError,
  PLAINTEXT_EXPORT_WARNING,
  TRANSFER_ERROR_CODES,
  type ExportCategory,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import {
  bundleFileName,
  exportFileName,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file-name';
import {
  runExportBundle,
  type BundleExportResult,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-bundle';
import {
  EXPORT_CATEGORY_ORDER,
  runExport,
  type ChatroomExportPort,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { ChatroomTransferDeps } from './deps.js';
import { prepareDefaultExportsDir, writeExportFileAtomically } from './file-io.js';
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
 * export is refused or fails; `--all` writes one bundle and fails without a
 * file when any chatroom fails twice.
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
  if (opts.all === true) {
    if (opts.chatroomId !== undefined) {
      throw new ChatroomTransferError(
        TRANSFER_ERROR_CODES.EXPORT_TARGET_CONFLICT,
        '--all and --chatroom-id cannot be used together'
      );
    }
    return { kind: 'all' };
  }
  if (opts.chatroomId !== undefined) return { kind: 'one', chatroomId: opts.chatroomId };
  throw new ChatroomTransferError(
    TRANSFER_ERROR_CODES.EXPORT_TARGET_REQUIRED,
    'pass --chatroom-id <id> or --all'
  );
}

/**
 * Exports every chatroom the caller owns on this machine into one bundle.
 *
 * Nothing is written until every chatroom has been read successfully: the
 * bundle is built in memory, then published once. A failed run therefore leaves
 * no file and no temp file.
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

  const rooms = (await deps.backend.query(api.chatroomExport.listForMachine, {
    sessionId,
    machineId,
  })) as ExportableChatroom[];
  if (rooms.length === 0) {
    deps.out(`No chatrooms found for machine ${machineId} that you own.`);
    return;
  }

  // One clock read feeds the bundle's `exportedAt`, every payload's
  // `exportedAt` and the file name, so all three name the same instant.
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

/**
 * Exports one chatroom and publishes its file. Used by `--chatroom-id`; the
 * caller prints the report. Reads the clock once, so the file's `exportedAt`
 * and its name agree.
 */
async function exportOne(
  deps: ChatroomTransferDeps,
  sessionId: SessionId,
  chatroomId: string,
  path: string | undefined
): Promise<ExportReport> {
  const port = makeExportPort(deps, sessionId);

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

  const dir = await resolveExportDir(deps, path);
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
  printAttachmentLine(out, attachmentTotals(report.omitted));
  out(PLAINTEXT_EXPORT_WARNING);
}

/** The attachment omission as one `{count, bytes}` tally, for the shared line. */
function attachmentTotals(omitted: Record<string, Omission>): { count: number; bytes: number } {
  const attachments = omitted.chatroom_fileAttachments ?? { count: 0, bytes: 0 };
  return { count: attachments.count ?? 0, bytes: attachments.bytes ?? 0 };
}

/** `key: reason` for policy exclusions, `key (n): reason` for counted filters. */
function printOmission(out: (line: string) => void, key: string, omission: Omission): void {
  const count = omission.count === null ? '' : ` (${omission.count})`;
  out(`    ${key}${count}: ${omission.reason}`);
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
