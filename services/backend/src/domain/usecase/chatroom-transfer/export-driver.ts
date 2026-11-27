/**
 * Chatroom export — per-chatroom builder.
 *
 * `runExportBundle` (export-bundle.ts) calls it once per chatroom and is the only
 * caller; it is not a user-facing entry point.
 *
 * Orchestrates a consistent snapshot over `ChatroomExportPort`:
 *
 * 1. Read the stamp. Attachments are omitted by the build, not refused here.
 * 2. Page every category to completion, tracking an approximate serialized size
 *    so an oversized room fails early.
 * 3. Re-read the mutable categories (derived from the registry) and compare
 *    their canonical JSON. Append-only categories are protected by the stamp.
 * 4. Read the stamp again and compare. Any difference is
 *    `EXPORT_CHATROOM_CHANGED`; an export never retries, because the caller
 *    (the CLI) can simply run it again.
 * 5. Build the file and check the exact byte length of the JSON.
 *
 * No file I/O here: the CLI writes the bytes. The port is the only seam, so the
 * driver and its tests never touch Convex server code (the read module is
 * imported for types only). The registry is imported at runtime for the mutable
 * category list; it has type-only Convex imports.
 */

import { buildExportFile } from './export-build';
import type { ExportPage, ExportRawRow, ExportStamp } from './export-read';
import { exportedEntries } from './registry';
import {
  canonicalJson,
  ChatroomTransferError,
  EXPORT_MAX_FILE_BYTES,
  TRANSFER_ERROR_CODES,
  type ChatroomExportFileV1,
  type ExportCategory,
} from '../../entities/chatroom-transfer-file';

/** Every category, in dependency order (the room row anchors the rest). */
const EXPORT_CATEGORY_ORDER: readonly ExportCategory[] = [
  'room',
  'workspaces',
  'agentConfigs',
  'messages',
  'messageQueue',
  'tasks',
  'backlog',
  'artifacts',
  'contexts',
  'scheduledPrompts',
  'savedCommands',
  'skillCustomizations',
];

/** The export reads pages through this port; the CLI Convex client and convex-test both adapt to it. */
export interface ChatroomExportPort {
  getStamp(chatroomId: string): Promise<ExportStamp>;
  readPage(args: {
    chatroomId: string;
    category: ExportCategory;
    cursor: string | null;
  }): Promise<ExportPage>;
}

export interface RunExportArgs {
  chatroomId: string;
  cliVersion: string;
  now: () => Date;
  /** Test seam: 256 MiB is impractical in tests, production uses the default. */
  limits?: { maxFileBytes?: number };
}

export async function runExport(
  port: ChatroomExportPort,
  args: RunExportArgs
): Promise<{ file: ChatroomExportFileV1; json: string }> {
  const maxFileBytes = args.limits?.maxFileBytes ?? EXPORT_MAX_FILE_BYTES;

  const stamp0 = await port.getStamp(args.chatroomId);

  const raw = await readCategories(port, args.chatroomId, maxFileBytes);
  await assertUnchanged(port, args.chatroomId, raw, stamp0);

  const file = await buildExportFile({
    sourceChatroomId: args.chatroomId,
    cliVersion: args.cliVersion,
    exportedAt: args.now().toISOString(),
    raw,
    stamp: stamp0,
  });
  return { file, json: serializeWithinLimit(file, maxFileBytes) };
}

/** Step 2: page every category and fail early on size. */
async function readCategories(
  port: ChatroomExportPort,
  chatroomId: string,
  maxFileBytes: number
): Promise<Record<ExportCategory, ExportRawRow[]>> {
  const raw = emptyRaw();
  const budget = { bytes: 0, max: maxFileBytes };
  for (const category of EXPORT_CATEGORY_ORDER) {
    raw[category] = await readAll(port, chatroomId, category, (row) => countBytes(budget, row));
  }
  return raw;
}

function countBytes(budget: { bytes: number; max: number }, row: ExportRawRow): void {
  budget.bytes += JSON.stringify(row.fields).length;
  if (budget.bytes > budget.max) throw tooLarge(budget.max);
}

/** Steps 3-5: re-read the mutable categories, then compare the stamps. */
async function assertUnchanged(
  port: ChatroomExportPort,
  chatroomId: string,
  raw: Record<ExportCategory, ExportRawRow[]>,
  stamp0: ExportStamp
): Promise<void> {
  for (const category of mutableCategories()) {
    const again = await readAll(port, chatroomId, category, () => undefined);
    if (canonicalJson(again) !== canonicalJson(raw[category])) throw changed(category);
  }

  const stamp1 = await port.getStamp(chatroomId);
  if (canonicalJson(stamp1) !== canonicalJson(stamp0)) throw changed(null);
}

/** Step 7: the exact size check on the serialized file. */
function serializeWithinLimit(file: ChatroomExportFileV1, maxFileBytes: number): string {
  const json = JSON.stringify(file);
  if (new TextEncoder().encode(json).byteLength > maxFileBytes) throw tooLarge(maxFileBytes);
  return json;
}

/** Pages one category to completion. */
async function readAll(
  port: ChatroomExportPort,
  chatroomId: string,
  category: ExportCategory,
  onRow: (row: ExportRawRow) => void
): Promise<ExportRawRow[]> {
  const rows: ExportRawRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await port.readPage({ chatroomId, category, cursor });
    appendRows(page.rows, rows, onRow);
    if (page.isDone) return rows;
    cursor = nextCursor(page, category);
  }
}

function appendRows(
  pageRows: readonly ExportRawRow[],
  rows: ExportRawRow[],
  onRow: (row: ExportRawRow) => void
): void {
  for (const row of pageRows) {
    onRow(row);
    rows.push(row);
  }
}

/**
 * Defensive: a server that reports more work without a cursor would make the
 * driver loop forever. The server also guards the empty-page case.
 */
function nextCursor(page: ExportPage, category: ExportCategory): string {
  if (page.continueCursor === null) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.EXPORT_PAGE_STALLED,
      `Export page for ${category} reported more work but returned no cursor.`
    );
  }
  return page.continueCursor;
}

/** Mutable categories from the registry: `room` plus the eight rewritten or filtered ones. */
function mutableCategories(): ExportCategory[] {
  const categories: ExportCategory[] = [];
  for (const entry of exportedEntries()) {
    if (entry.stability !== 'mutable') continue;
    if (!categories.includes(entry.category)) categories.push(entry.category);
  }
  return categories;
}

function emptyRaw(): Record<ExportCategory, ExportRawRow[]> {
  return {
    room: [],
    workspaces: [],
    agentConfigs: [],
    messages: [],
    messageQueue: [],
    tasks: [],
    backlog: [],
    artifacts: [],
    contexts: [],
    scheduledPrompts: [],
    savedCommands: [],
    skillCustomizations: [],
  };
}

function changed(category: ExportCategory | null): ChatroomTransferError {
  const cause =
    category === null
      ? 'the chatroom changed while the export was reading'
      : `${category} changed while the export was reading`;
  return new ChatroomTransferError(
    TRANSFER_ERROR_CODES.EXPORT_CHATROOM_CHANGED,
    `Export aborted because ${cause}; run the export again.`
  );
}

function tooLarge(maxFileBytes: number): ChatroomTransferError {
  return new ChatroomTransferError(
    TRANSFER_ERROR_CODES.EXPORT_TOO_LARGE,
    `Export exceeds the ${maxFileBytes}-byte limit; remove content and run the export again.`
  );
}
