/**
 * Chatroom export — server-side reads.
 *
 * This module turns Convex rows into the raw rows the export build consumes. It
 * is the only export module that imports Convex server code; auth happens in the
 * Convex wrapper (`convex/chatroomExport.ts`), and it never writes.
 *
 * ## Registry is the single source of field metadata
 *
 * The index a category pages through, the field rules and the category's
 * stability all come from `registry.ts`. This module adds only the two things
 * the registry cannot express:
 *
 * - `EXPORT_BUILD_INPUT_FIELDS` — fields the build needs but the file never
 *   carries (`removedAt`, `attachedWorkflowIds`, launch timing and team).
 * - the `room` category — one composite row built from the room, its active team
 *   structure and its primary workspace pointer. Those three tables share the
 *   `room` category, so a category-to-table lookup would be ambiguous.
 *
 * Everything the registry marks `system` or `drop` (and `_id`/`_creationTime`) is
 * stripped, except the build inputs above, so a discarded field cannot leak.
 *
 * ## Paging
 *
 * Convex allows one `.paginate()` per function call, so every `readPage` query
 * reads exactly one page and the driver advances by cursor. A page that reports
 * `isDone: false` but yields no rows would make the driver loop forever, so it
 * fails with `EXPORT_PAGE_STALLED` instead. A single row larger than the byte
 * budget is returned on its own page and read normally.
 */

import { ConvexError } from 'convex/values';

import { exportedEntries, type FieldRule } from './registry';
import { exportedEntryFor, rulesOf } from './registry-lookup';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import {
  EXPORT_PAGE_MAX_BYTES,
  EXPORT_PAGE_MAX_ROWS,
  TRANSFER_ERROR_CODES,
  type ExportCategory,
} from '../../entities/chatroom-transfer-file';

/**
 * Consistency stamp: one cheap projection of everything mutable plus the
 * append-only high-water marks. The driver compares it before and after paging;
 * any difference means the room changed under the export.
 */
export interface ExportStamp {
  lastActivityAt: number | null;
  nextQueuePosition: number | null;
  latestMessage: { id: string; creationTime: number } | null;
  taskCounts: {
    pending: number;
    acknowledged: number;
    inProgress: number;
    completed: number;
    queueSize: number;
  } | null;
  /** Every paginated category (all except `room`). */
  latest: Partial<Record<ExportCategory, { id: string; creationTime: number } | null>>;
  attachmentRows: { count: number; capped: boolean; totalBytes: number };
}

/**
 * One source row. Id-valued fields still hold the source id strings; the build
 * rewrites them to keys. `fields` contains the registry's emitting rules plus
 * `EXPORT_BUILD_INPUT_FIELDS` for the table.
 */
export interface ExportRawRow {
  id: string;
  creationTime: number;
  fields: Record<string, unknown>;
}

export interface ExportPage {
  rows: ExportRawRow[];
  continueCursor: string | null;
  isDone: boolean;
}

/**
 * Table fields the build needs but the file never carries. Keep this list short:
 * every entry is a deliberate exception to the registry's `drop` rule.
 */
export const EXPORT_BUILD_INPUT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  chatroom_workspaces: ['removedAt'],
  chatroom_agentLastSentLaunchRequests: ['teamStructureId', 'requestedAt'],
  chatroom_messages: ['attachedWorkflowIds'],
  chatroom_messageQueue: ['attachedWorkflowIds'],
} as const;

/** Rules that survive into the file (after renames applied by the build). */
const EMITTED_RULES: ReadonlySet<FieldRule['rule']> = new Set([
  'copy',
  'ref',
  'reset',
  'rebind',
  'derive',
]);

/** Registry `read` is typed `unknown` so the registry stays free of query generics. */
interface PagedQuery {
  order: (direction: 'asc' | 'desc') => { first: () => Promise<DocRow | null> };
  paginate: (opts: {
    numItems: number;
    cursor: string | null;
    maximumBytesRead?: number;
  }) => Promise<{ page: DocRow[]; continueCursor: string; isDone: boolean }>;
}

interface DocRow {
  _id: string;
  _creationTime: number;
  [field: string]: unknown;
}

/** The raw field name the room row uses for the primary workspace pointer. */
const PRIMARY_WORKSPACE_INPUT = 'primaryWorkspaceId';

/** Fields of an exported table that belong in a raw row. */
function exportableFields(table: string, doc: DocRow): Record<string, unknown> {
  const rules = rulesOf(table);
  const buildInputs = new Set(EXPORT_BUILD_INPUT_FIELDS[table] ?? []);
  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(doc)) {
    if (isExportedField(name, rules, buildInputs)) fields[name] = value;
  }
  return fields;
}

/** A field survives when a registry rule emits it or the build needs it as an input. */
function isExportedField(
  name: string,
  rules: Record<string, FieldRule>,
  buildInputs: ReadonlySet<string>
): boolean {
  if (isDocumentMeta(name)) return false;
  return emitsField(rules[name]) || buildInputs.has(name);
}

function isDocumentMeta(name: string): boolean {
  return name === '_id' || name === '_creationTime';
}

function emitsField(rule: FieldRule | undefined): boolean {
  return rule !== undefined && EMITTED_RULES.has(rule.rule);
}

/** Copy-rule fields of a table, used to compose the `room` row. */
function copyFields(table: string, doc: DocRow): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [name, rule] of Object.entries(rulesOf(table))) {
    if (rule.rule !== 'copy') continue;
    const value = doc[name];
    if (value !== undefined) fields[name] = value;
  }
  return fields;
}

/**
 * Fails when Convex reports more work but returns no rows. Exported so the stall
 * path is provable without a database.
 */
export function assertNotStalled(
  page: { rows: readonly unknown[]; isDone: boolean },
  category: ExportCategory
): void {
  if (page.rows.length === 0 && !page.isDone) {
    throw new ConvexError({
      code: TRANSFER_ERROR_CODES.EXPORT_PAGE_STALLED,
      message: `Export page for ${category} returned no rows but reported more work; refusing to loop.`,
    });
  }
}

/**
 * Reads the room row plus the newest row and the high-water marks of every
 * paginated category. Messages are read once: `latestMessage` is
 * `latest.messages`.
 */
export async function readExportStamp(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ExportStamp> {
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  const latest = await readLatestRows(ctx, chatroomId);

  return {
    lastActivityAt: nullish(room?.lastActivityAt),
    nextQueuePosition: nullish(room?.nextQueuePosition),
    latestMessage: nullish(latest.messages),
    taskCounts: await readTaskCounts(ctx, chatroomId),
    latest,
    attachmentRows: await readAttachmentRows(ctx, chatroomId),
  };
}

function nullish<T>(value: T | undefined | null): T | null {
  return value ?? null;
}

/** One newest row per paginated category, keyed by category. */
async function readLatestRows(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ExportStamp['latest']> {
  const latest: ExportStamp['latest'] = {};
  for (const entry of exportedEntries()) {
    if (entry.category === 'room') continue;
    const row = await (entry.read(ctx, chatroomId) as PagedQuery).order('desc').first();
    latest[entry.category] = row ? { id: row._id, creationTime: row._creationTime } : null;
  }
  return latest;
}

async function readTaskCounts(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ExportStamp['taskCounts']> {
  const counts = await ctx.db
    .query('chatroom_taskCounts')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  if (!counts) return null;
  return {
    pending: counts.pending,
    acknowledged: counts.acknowledged,
    inProgress: counts.inProgress,
    completed: counts.completed,
    queueSize: counts.queueSize,
  };
}

/**
 * Bound the attachment count: 1001 rows is enough to prove "more than 1000".
 * `totalBytes` sums the same bounded set, so a size change is detected too.
 */
async function readAttachmentRows(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ExportStamp['attachmentRows']> {
  const rows = await ctx.db
    .query('chatroom_fileAttachments')
    .withIndex('by_chatroom_status_attachedAt', (q) => q.eq('chatroomId', chatroomId))
    .take(1001);
  let totalBytes = 0;
  for (const row of rows) totalBytes += row.sizeBytes;
  return { count: rows.length, capped: rows.length > 1000, totalBytes };
}

/**
 * Reads one page of a category. The `room` category is a single unpaged row;
 * every other category pages its registry read by cursor.
 */
export async function readExportPage(
  ctx: QueryCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; category: ExportCategory; cursor: string | null }
): Promise<ExportPage> {
  if (args.category === 'room') {
    return readRoomPage(ctx, args.chatroomId);
  }

  const { table, entry } = exportedEntryFor(args.category);
  const page = await (entry.read(ctx, args.chatroomId) as PagedQuery).paginate({
    numItems: EXPORT_PAGE_MAX_ROWS,
    cursor: args.cursor,
    maximumBytesRead: EXPORT_PAGE_MAX_BYTES,
  });
  const rows = page.page.map((doc) => ({
    id: doc._id,
    creationTime: doc._creationTime,
    fields: exportableFields(table, doc),
  }));

  assertNotStalled({ rows, isDone: page.isDone }, args.category);
  return { rows, continueCursor: page.continueCursor, isDone: page.isDone };
}

/**
 * The `room` category: one row holding the room's copy fields, the active team
 * structure and the primary workspace pointer. The pointer keeps the raw field
 * name `primaryWorkspaceId`; the build rewrites it to `primaryWorkspaceKey`.
 */
async function readRoomPage(ctx: QueryCtx, chatroomId: Id<'chatroom_rooms'>): Promise<ExportPage> {
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!room) return { rows: [], continueCursor: null, isDone: true };

  const fields = copyFields('chatroom_rooms', room as unknown as DocRow);

  const team = await ctx.db
    .query('chatroom_activeTeamStructures')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  if (team) {
    Object.assign(fields, copyFields('chatroom_activeTeamStructures', team as unknown as DocRow));
  }

  const primary = await ctx.db
    .query('chatroom_primaryWorkspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  if (primary) fields[PRIMARY_WORKSPACE_INPUT] = primary.workspaceId;

  return {
    rows: [{ id: room._id, creationTime: room._creationTime, fields }],
    continueCursor: null,
    isDone: true,
  };
}
