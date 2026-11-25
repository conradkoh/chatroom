/**
 * Chatroom export — pure build.
 *
 * Turns the raw rows the reader returns into the canonical `chatroom-export`
 * file. No Convex imports, no I/O: the only async step is the checksum.
 *
 * ## Order of operations
 *
 * 1. Refuse attachments. A room with binary attachments cannot be exported, and
 *    so cannot a room whose messages still point at attachment rows.
 * 2. Filter and count: removed workspaces, deleted backlog rows, launch requests
 *    for another team, launch requests for a removed workspace, superseded launch
 *    requests. Every drop is counted in the omitted manifest.
 * 3. Assign ordinal keys to every retained row (pass 1), so a forward reference
 *    can resolve.
 * 4. Emit rows (pass 2), rewriting every registry `ref` through one
 *    id → key map, renaming `machineId` to `sourceMachineId` and
 *    `terminalHandoffKey` to `terminalHandoffRole`.
 *
 * A ref to an id that is neither retained nor filtered out is a corrupt source
 * row, so it fails with `EXPORT_DANGLING_REFERENCE` rather than guessing.
 *
 * Field names and rules come from the registry; this module hardcodes only the
 * file's room key, the counted omission keys and the two renames the design
 * names. The room row's raw primary pointer is `primaryWorkspaceId` (emitted by
 * `export-read.ts`) and becomes `primaryWorkspaceKey`.
 */

import type { ExportRawRow, ExportStamp } from './export-read';
import { omittedManifest, type FieldRule } from './registry';
import { exportedEntryFor, rulesOf } from './registry-lookup';
import {
  canonicalJson,
  CHATROOM_EXPORT_FORMAT_VERSION,
  CHATROOM_EXPORT_KIND,
  ChatroomTransferError,
  contentOf,
  sha256Hex,
  TRANSFER_ERROR_CODES,
  type ChatroomExportContent,
  type ChatroomExportFileV1,
  type ExportCategory,
  type ExportRow,
} from '../../entities/chatroom-transfer-file';

/** The single room row's key. Ordinal prefixes keep every other key unique. */
const ROOM_KEY = 'r0';

/** Raw field name the reader uses for the room's primary workspace pointer. */
const PRIMARY_WORKSPACE_INPUT = 'primaryWorkspaceId';
/** File field name for the same pointer, rewritten to a workspace key. */
const PRIMARY_WORKSPACE_OUTPUT = 'primaryWorkspaceKey';

/** Rebind output: `machineId` is informational and prefixed. */
const SOURCE_MACHINE_FIELD = 'sourceMachineId';
/** Derive output: the role, recomputed from the imported role on import. */
const HANDOFF_ROLE_FIELD = 'terminalHandoffRole';

/**
 * Ordinal prefix per paginated category. Keys are assigned in read order, so
 * `m0` is the oldest message and `m449` the newest of a 450-row page run.
 */
const ORDINAL_PREFIXES: Readonly<Record<Exclude<ExportCategory, 'room'>, string>> = {
  messages: 'm',
  tasks: 't',
  backlog: 'b',
  artifacts: 'a',
  contexts: 'c',
  scheduledPrompts: 's',
  messageQueue: 'q',
  workspaces: 'w',
  agentConfigs: 'g',
  savedCommands: 'k',
  skillCustomizations: 'z',
};

/** The filtered-row counters, one per counted key in the omitted manifest. */
interface BuildCounts {
  workspaceRemovals: number;
  backlogDeleted: number;
  launchRequestsOtherTeam: number;
  launchRequestsSuperseded: number;
  attachedWorkflows: number;
}

export interface BuildExportInput {
  sourceChatroomId: string;
  cliVersion: string;
  exportedAt: string;
  raw: Record<ExportCategory, ExportRawRow[]>;
  stamp: ExportStamp;
}

/** Builds the file, including the checksum over its canonical content. */
export async function buildExportFile(input: BuildExportInput): Promise<ChatroomExportFileV1> {
  refuseAttachments(input.raw, input.stamp);

  const filtered = filterRows(input.raw);
  const keys = assignKeys(filtered.raw);
  const content = emitContent(filtered.raw, keys, filtered.filteredIds);
  const checksum = await sha256Hex(canonicalJson(contentOf(content)));

  return {
    formatVersion: CHATROOM_EXPORT_FORMAT_VERSION,
    kind: CHATROOM_EXPORT_KIND,
    exportedAt: input.exportedAt,
    source: { chatroomId: input.sourceChatroomId, cliVersion: input.cliVersion },
    omitted: fillOmissions(filtered.counts),
    checksum,
    ...content,
  };
}

// ---------------------------------------------------------------------------
// 1. Refusals
// ---------------------------------------------------------------------------

/**
 * Attachments are committed service state with binaries in storage, so the
 * export refuses rather than silently dropping them. The message carries the
 * count so the user knows what to remove.
 */
function refuseAttachments(raw: Record<ExportCategory, ExportRawRow[]>, stamp: ExportStamp): void {
  const { count, capped } = stamp.attachmentRows;
  if (count > 0) {
    const shown = capped ? `${count}+` : `${count}`;
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.EXPORT_ATTACHMENTS_PRESENT,
      `This chatroom has ${shown} file attachment(s); attachments cannot be exported.`,
      []
    );
  }

  const messagesWithFiles = raw.messages.filter((row) =>
    isNonEmptyArray(row.fields.attachedFileIds)
  ).length;
  if (messagesWithFiles > 0) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.EXPORT_ATTACHMENTS_PRESENT,
      `This chatroom has ${messagesWithFiles} message(s) that reference file attachments; attachments cannot be exported.`,
      []
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Filters and counts
// ---------------------------------------------------------------------------

interface FilteredRaw {
  raw: Record<ExportCategory, ExportRawRow[]>;
  counts: BuildCounts;
  filteredIds: Set<string>;
}

/** Drops the rows the file cannot carry and counts each drop. */
function filterRows(raw: Record<ExportCategory, ExportRawRow[]>): FilteredRaw {
  const counts: BuildCounts = {
    workspaceRemovals: 0,
    backlogDeleted: 0,
    launchRequestsOtherTeam: 0,
    launchRequestsSuperseded: 0,
    attachedWorkflows: 0,
  };
  /** Ids of rows deliberately left out, so a ref to them is omitted, not fatal. */
  const filteredIds = new Set<string>();
  const removedWorkspaceIds = new Set<string>();

  const workspaces = raw.workspaces.filter((row) => {
    if (!isRemovedWorkspace(row)) return true;
    counts.workspaceRemovals += 1;
    filteredIds.add(row.id);
    removedWorkspaceIds.add(row.id);
    return false;
  });

  const backlog = raw.backlog.filter((row) => {
    if (row.fields.status !== 'deleted') return true;
    counts.backlogDeleted += 1;
    filteredIds.add(row.id);
    return false;
  });

  const roomTeamStructureId = requireRoomRow(raw).fields.teamStructureId;
  const sameTeamConfigs = raw.agentConfigs.filter((row) => {
    if (row.fields.teamStructureId === roomTeamStructureId) return true;
    counts.launchRequestsOtherTeam += 1;
    return false;
  });

  const liveWorkspaceConfigs = sameTeamConfigs.filter((row) => {
    const workspaceId = row.fields.workspaceId;
    if (typeof workspaceId !== 'string' || !removedWorkspaceIds.has(workspaceId)) return true;
    counts.workspaceRemovals += 1;
    filteredIds.add(row.id);
    return false;
  });

  const agentConfigs = dedupeLaunchRequests(liveWorkspaceConfigs, counts, filteredIds);
  countWorkflowAttachments(raw, counts);

  return {
    raw: {
      room: raw.room,
      workspaces,
      agentConfigs,
      messages: raw.messages,
      messageQueue: raw.messageQueue,
      tasks: raw.tasks,
      backlog,
      artifacts: raw.artifacts,
      contexts: raw.contexts,
      scheduledPrompts: raw.scheduledPrompts,
      savedCommands: raw.savedCommands,
      skillCustomizations: raw.skillCustomizations,
    },
    counts,
    filteredIds,
  };
}

function isRemovedWorkspace(row: ExportRawRow): boolean {
  const removedAt = row.fields.removedAt;
  return removedAt !== undefined && removedAt !== null;
}

/**
 * One launch request per (workspace, role): the latest `requestedAt` wins, older
 * rows are counted as superseded. Survivors are ordered oldest-first so the
 * file is deterministic.
 */
function dedupeLaunchRequests(
  rows: ExportRawRow[],
  counts: BuildCounts,
  filteredIds: Set<string>
): ExportRawRow[] {
  const latestByWorkspaceRole = new Map<string, ExportRawRow>();
  for (const row of rows) {
    const grouping = `${String(row.fields.workspaceId)}|${String(row.fields.role)}`;
    const current = latestByWorkspaceRole.get(grouping);
    if (!current) {
      latestByWorkspaceRole.set(grouping, row);
      continue;
    }
    counts.launchRequestsSuperseded += 1;
    if (requestedAt(row) >= requestedAt(current)) {
      filteredIds.add(current.id);
      latestByWorkspaceRole.set(grouping, row);
    } else {
      filteredIds.add(row.id);
    }
  }
  return [...latestByWorkspaceRole.values()].sort((a, b) => requestedAt(a) - requestedAt(b));
}

function requestedAt(row: ExportRawRow): number {
  return typeof row.fields.requestedAt === 'number' ? row.fields.requestedAt : 0;
}

/** Deprecated workflow attachments are not carried; count them for the manifest. */
function countWorkflowAttachments(
  raw: Record<ExportCategory, ExportRawRow[]>,
  counts: BuildCounts
): void {
  for (const row of [...raw.messages, ...raw.messageQueue]) {
    const workflowIds = row.fields.attachedWorkflowIds;
    if (Array.isArray(workflowIds)) counts.attachedWorkflows += workflowIds.length;
  }
}

// ---------------------------------------------------------------------------
// 3. Key assignment
// ---------------------------------------------------------------------------

/**
 * Pass 1: one key per retained row in every category, so forward references
 * resolve. Category order does not matter because prefixes are distinct.
 */
function assignKeys(raw: Record<ExportCategory, ExportRawRow[]>): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [category, rows] of Object.entries(raw) as [ExportCategory, ExportRawRow[]][]) {
    if (category === 'room') continue;
    const prefix = ORDINAL_PREFIXES[category];
    rows.forEach((row, index) => keys.set(row.id, `${prefix}${index}`));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// 4. Row emission
// ---------------------------------------------------------------------------

function emitContent(
  raw: Record<ExportCategory, ExportRawRow[]>,
  keys: Map<string, string>,
  filteredIds: Set<string>
): ChatroomExportContent {
  return {
    room: emitRoomRow(requireRoomRow(raw), keys, filteredIds),
    workspaces: emitRows('workspaces', raw.workspaces, keys, filteredIds),
    agentConfigs: emitRows('agentConfigs', raw.agentConfigs, keys, filteredIds),
    messages: emitRows('messages', raw.messages, keys, filteredIds),
    messageQueue: emitRows('messageQueue', raw.messageQueue, keys, filteredIds),
    tasks: emitRows('tasks', raw.tasks, keys, filteredIds),
    backlog: emitRows('backlog', raw.backlog, keys, filteredIds),
    artifacts: emitRows('artifacts', raw.artifacts, keys, filteredIds),
    contexts: emitRows('contexts', raw.contexts, keys, filteredIds),
    scheduledPrompts: emitRows('scheduledPrompts', raw.scheduledPrompts, keys, filteredIds),
    savedCommands: emitRows('savedCommands', raw.savedCommands, keys, filteredIds),
    skillCustomizations: emitRows(
      'skillCustomizations',
      raw.skillCustomizations,
      keys,
      filteredIds
    ),
  };
}

function emitRows(
  category: Exclude<ExportCategory, 'room'>,
  rows: ExportRawRow[],
  keys: Map<string, string>,
  filteredIds: Set<string>
): ExportRow[] {
  const { table } = exportedEntryFor(category);
  return rows.map((row) => emitRow(table, row, keys, filteredIds));
}

/** Everything an emitter needs besides the field name and its value. */
interface EmitContext {
  out: ExportRow;
  table: string;
  keys: Map<string, string>;
  filteredIds: Set<string>;
}

type FieldEmitter = (ctx: EmitContext, field: string, value: unknown) => void;

/**
 * One emitter per registry rule. The table keeps `emitRow` branch-free, and a
 * new rule is a registry change plus (at most) one entry here.
 */
const FIELD_EMITTERS: Readonly<Record<FieldRule['rule'], FieldEmitter>> = {
  copy: (ctx, field, value) => emitValue(ctx.out, field, value),
  reset: (ctx, field, value) => emitValue(ctx.out, field, value),
  ref: (ctx, field, value) => emitRef(ctx, field, field, value),
  rebind: (ctx, _field, value) => emitValue(ctx.out, SOURCE_MACHINE_FIELD, value),
  derive: (ctx, field, value) => emitHandoffRole(ctx.out, ctx.table, field, value),
  system: () => undefined,
  drop: () => undefined,
};

/** Pass 2: emit only the fields whose rule writes them, with refs rewritten. */
function emitRow(
  table: string,
  row: ExportRawRow,
  keys: Map<string, string>,
  filteredIds: Set<string>
): ExportRow {
  const key = keys.get(row.id);
  if (key === undefined) {
    throw new Error(`Chatroom export build: no key assigned for ${table} row ${row.id}`);
  }

  const ctx: EmitContext = {
    out: { _key: key, _creationTime: row.creationTime },
    table,
    keys,
    filteredIds,
  };
  for (const [field, rule] of Object.entries(rulesOf(table))) {
    FIELD_EMITTERS[rule.rule](ctx, field, row.fields[field]);
  }
  return ctx.out;
}

/**
 * The room category merges three tables: the room's copy fields plus
 * `teamStructureId` (a copy field of `chatroom_activeTeamStructures`) and the
 * primary workspace pointer.
 */
function emitRoomRow(
  row: ExportRawRow,
  keys: Map<string, string>,
  filteredIds: Set<string>
): ExportRow {
  const out: ExportRow = { _key: ROOM_KEY, _creationTime: row.creationTime };
  const ctx: EmitContext = { out, table: 'chatroom_primaryWorkspaces', keys, filteredIds };
  for (const [field, value] of Object.entries(row.fields)) {
    if (field === PRIMARY_WORKSPACE_INPUT) continue;
    emitValue(out, field, value);
  }
  emitRef(ctx, 'workspaceId', PRIMARY_WORKSPACE_OUTPUT, row.fields[PRIMARY_WORKSPACE_INPUT]);
  return out;
}

function emitValue(out: ExportRow, field: string, value: unknown): void {
  if (value !== undefined) out[field] = value;
}

/**
 * Rewrites one ref field. An array loses entries that point at filtered rows; a
 * scalar is omitted when its target was filtered. Anything else is dangling.
 */
function emitRef(ctx: EmitContext, sourceField: string, outputField: string, value: unknown): void {
  const rewritten = rewriteRefValue(ctx, sourceField, value);
  if (rewritten !== undefined) ctx.out[outputField] = rewritten;
}

function rewriteRefValue(
  ctx: EmitContext,
  field: string,
  value: unknown
): string | string[] | undefined {
  if (Array.isArray(value)) return rewriteRefArray(ctx, field, value);
  if (isAbsent(value)) return undefined;
  if (typeof value !== 'string') throw dangling(ctx.table, field, String(value));
  return rewriteRef(ctx.table, field, value, ctx.keys, ctx.filteredIds);
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

/** Array refs keep every entry that resolves and drop the filtered ones. */
function rewriteRefArray(ctx: EmitContext, field: string, ids: unknown[]): string[] {
  const rewritten: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string') throw dangling(ctx.table, field, String(id));
    const key = rewriteRef(ctx.table, field, id, ctx.keys, ctx.filteredIds);
    if (key !== undefined) rewritten.push(key);
  }
  return rewritten;
}

/** `undefined` means the target was deliberately filtered out of the export. */
function rewriteRef(
  table: string,
  field: string,
  id: string,
  keys: Map<string, string>,
  filteredIds: Set<string>
): string | undefined {
  const key = keys.get(id);
  if (key !== undefined) return key;
  if (filteredIds.has(id)) return undefined;
  throw dangling(table, field, id);
}

/** `terminalHandoffKey` is `<chatroomId>:<originMessageId>:<role>:user`. */
function emitHandoffRole(out: ExportRow, table: string, field: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string') {
    throw new Error(`Chatroom export build: ${table}.${field} is not a string`);
  }
  const segments = value.split(':');
  if (segments.length !== 4) {
    throw new Error(`Chatroom export build: ${table}.${field} is not a 4-segment key: ${value}`);
  }
  out[HANDOFF_ROLE_FIELD] = segments[2];
}

// ---------------------------------------------------------------------------
// Manifest and helpers
// ---------------------------------------------------------------------------

/** Every counted omission gets its number; everything else keeps `count: null`. */
function fillOmissions(
  counts: BuildCounts
): Record<string, { count: number | null; reason: string }> {
  const omitted = omittedManifest();
  for (const [key, count] of Object.entries(counts)) {
    const existing = omitted[key];
    if (!existing) {
      throw new Error(`Chatroom export build: omitted manifest has no key ${key}`);
    }
    omitted[key] = { count, reason: existing.reason };
  }
  return omitted;
}

function requireRoomRow(raw: Record<ExportCategory, ExportRawRow[]>): ExportRawRow {
  const room = raw.room[0];
  if (!room) throw new Error('Chatroom export build: the export has no room row');
  return room;
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function dangling(table: string, field: string, id: string): ChatroomTransferError {
  return new ChatroomTransferError(
    TRANSFER_ERROR_CODES.EXPORT_DANGLING_REFERENCE,
    `${table}.${field} references ${id}, which is not part of this export; the source chatroom is inconsistent.`,
    [`${table}.${field} → ${id}`]
  );
}
