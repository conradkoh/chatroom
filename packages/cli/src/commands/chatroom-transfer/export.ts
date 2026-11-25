/**
 * `chatroom export` — read one chatroom through Convex, publish one JSON file.
 *
 * The backend owns the read, the consistency check and the build
 * (`runExport`); this module only adapts `BackendOps` to the export port,
 * publishes the bytes with `writeExportFileAtomically`, and prints the report.
 *
 * Every failure is thrown to the command wrapper in `register.ts`, which
 * renders it as `❌ [CODE] message` and exits 1. Success is printed only after
 * the file is linked into place, so a printed path always names a real file.
 */

import { join, resolve } from 'node:path';

import {
  ChatroomTransferError,
  type ExportCategory,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import {
  EXPORT_CATEGORY_ORDER,
  runExport,
  type ChatroomExportPort,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';

import type { ChatroomTransferDeps } from './deps.js';
import { exportFileName, prepareDefaultExportsDir, writeExportFileAtomically } from './file-io.js';
import { requireTransferSession } from './session-guard.js';
import { api } from '../../api.js';
import { getConvexErrorData, getErrorMessage } from '../../utils/convex-error.js';

/** One manifest entry: `count: null` means the exclusion is a policy, not a filtered row count. */
interface Omission {
  count: number | null;
  reason: string;
}

/** The export ships conversation content in plaintext; every success says so. */
const PLAINTEXT_WARNING =
  'warning: this file is plaintext and contains conversation content. Keep it private.';

/**
 * Exports `opts.chatroomId` into `<cwd>/.chatroom/exports` (or `opts.path`).
 *
 * Throws when the export is refused or fails; nothing is printed and no file
 * exists in that case.
 */
export async function exportChatroom(
  opts: { chatroomId: string; path?: string | undefined },
  deps: ChatroomTransferDeps
): Promise<void> {
  const sessionId = await requireTransferSession(deps);
  if (sessionId === null) return;

  const port: ChatroomExportPort = {
    getStamp: (chatroomId) =>
      deps.backend.query(api.chatroomExport.getStamp, { sessionId, chatroomId }),
    readPage: (args) => deps.backend.query(api.chatroomExport.readPage, { sessionId, ...args }),
  };

  // One clock read feeds both the file's `exportedAt` and its name, so the two
  // never disagree about which second the export belongs to.
  const at = deps.clock();
  const counts = new Map<ExportCategory, number>();
  const { file, json } = await runExport(port, {
    chatroomId: opts.chatroomId,
    cliVersion: deps.version,
    now: () => at,
    onProgress: (category, rows) => counts.set(category, rows),
  });

  const dir = opts.path ? resolve(deps.cwd(), opts.path) : join(deps.cwd(), '.chatroom', 'exports');
  if (!opts.path) await prepareDefaultExportsDir(deps.fs, dir);
  const filePath = await writeExportFileAtomically(
    deps.fs,
    dir,
    exportFileName(opts.chatroomId, at),
    json
  );

  printReport(deps.out, {
    chatroomId: opts.chatroomId,
    filePath,
    counts,
    omitted: file.omitted,
  });
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

/** Prints the path, the per-category counts, the omissions and the warning. */
function printReport(
  out: (line: string) => void,
  report: {
    chatroomId: string;
    filePath: string;
    counts: ReadonlyMap<ExportCategory, number>;
    omitted: Record<string, Omission>;
  }
): void {
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
  out(PLAINTEXT_WARNING);
}

/** `key: reason` for policy exclusions, `key (n): reason` for counted filters. */
function printOmission(out: (line: string) => void, key: string, omission: Omission): void {
  const count = omission.count === null ? '' : ` (${omission.count})`;
  out(`    ${key}${count}: ${omission.reason}`);
}
