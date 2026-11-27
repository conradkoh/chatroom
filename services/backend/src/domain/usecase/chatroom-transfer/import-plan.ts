/**
 * Chatroom import — pure validation and plan.
 *
 * Two jobs, no I/O and no database access:
 *
 * 1. `validateExportFile` proves an export file is safe to import: readable JSON,
 *    the right kind and version, an intact checksum, the row shape, unique keys
 *    and no dangling references. It returns a failure object for bad input; only
 *    programming errors throw.
 * 2. `buildImportPlan` turns a validated file plus a target machine description
 *    into the chunk list, header, finalize values and the report a driver applies.
 *    It is deterministic: the same input yields a deep-equal plan.
 *
 * ## Order of refusals
 *
 * `buildImportPlan` refuses an unknown team structure and invalid working
 * directories before any row work, because both make the whole file unusable.
 * Everything else (task reset, scheduled prompts, agent configs) is a transform
 * recorded in the report.
 *
 * ## Deferral (B3)
 *
 * A ref value is immediate only when every target row sits in a chunk with a
 * strictly smaller index. Anything else — same chunk, forward, or an array that
 * mixes both — is removed from the row and patched through a `links` chunk after
 * its targets exist. An array field is deferred whole.
 *
 * ## Purity
 *
 * The module imports the registry lookups, the format module and the pure
 * `normalizeWorkingDir`. It never imports Convex server code or `convex/values`;
 * the Convex preflight in `convex/chatroomImport.ts` is the only place that
 * touches the database (B10).
 */

import type { ImportChunk, ImportHeader, ImportRowPayload, LinkPatch } from './import-apply';
import { exportedEntryFor, rulesOf } from './registry-lookup';
import {
  canonicalJson,
  CHATROOM_EXPORT_FORMAT_VERSION,
  CHATROOM_EXPORT_KIND,
  contentOf,
  IMPORT_CHUNK_MAX_BYTES,
  IMPORT_CHUNK_MAX_ROWS,
  sha256Hex,
  TRANSFER_ERROR_CODES,
  type ChatroomExportContent,
  type ChatroomExportFileV1,
  type ExportRow,
  type TransferErrorCode,
} from '../../entities/chatroom-transfer-file';
import { normalizeWorkingDir } from '../agent/workspace-match';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What the Convex preflight learned about the target machine and team. */
export interface ImportTarget {
  machineId: string;
  availableHarnesses: string[];
  teamStructureKnown: boolean;
  invalidWorkingDirs: string[];
}

export type AgentConfigSkipReason =
  | 'harness_unavailable'
  | 'non_remote_agent_type'
  | 'no_workspace'
  | 'working_dir_mismatch'
  | 'empty_model'
  | 'superseded_by_merge';

export interface ImportReport {
  /** Retained rows per category; `agentConfigs` is the restored count. */
  counts: Record<string, number>;
  /** Workspace groups with more than one key; keys in file order, survivor first. */
  merged: { workingDir: string; keys: string[] }[];
  agentConfigsRestored: number;
  agentConfigsSkipped: { key: string; reason: AgentConfigSkipReason }[];
  tasksReset: number;
  /** Every imported scheduled prompt is paused, so this is the imported row count. */
  scheduledPromptsDisabled: number;
  messageTimesNotPreserved: true;
}

export interface ImportPlan {
  header: ImportHeader;
  finalize: {
    status: 'active' | 'completed';
    lastActivityAt: number | null;
    nextQueuePosition: number;
  };
  chunks: ImportChunk[];
  report: ImportReport;
}

export type ImportFailure = {
  ok: false;
  code: TransferErrorCode;
  message: string;
  details: string[];
};
export type ImportValidation = { ok: true; file: ChatroomExportFileV1 } | ImportFailure;
export type ImportPlanResult = { ok: true; plan: ImportPlan } | ImportFailure;

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Every non-room content property, in the file's declared order. */
const CONTENT_CATEGORIES = [
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
] as const;
type NonRoomCategory = (typeof CONTENT_CATEGORIES)[number];

/** Row-construction order. `links` is inserted later, between the two groups. */
const PHASE_ORDER = [
  'workspaces',
  'artifacts',
  'backlog',
  'scheduledPrompts',
  'messages',
  'tasks',
  'contexts',
  'messageQueue',
  'savedCommands',
  'skillCustomizations',
  'agentConfigs',
] as const;
type NonLinkPhase = (typeof PHASE_ORDER)[number];

/** Phases whose chunks come after the `links` phase. */
const PHASES_AFTER_LINKS: readonly NonLinkPhase[] = [
  'savedCommands',
  'skillCustomizations',
  'agentConfigs',
];

const ROOM_TABLE = 'chatroom_rooms';
const WORKSPACES_TABLE = exportedEntryFor('workspaces').table;
const MESSAGES_TABLE = exportedEntryFor('messages').table;
/** The room row's primary pointer mirrors this table's `workspaceId` ref. */
const PRIMARY_WORKSPACES_TABLE = 'chatroom_primaryWorkspaces';

/** Messages pass this derived field through unchanged; P8 derives the key from this role (import-apply.ts). */
const HANDOFF_ROLE_FIELD = 'terminalHandoffRole';

const NON_TERMINAL_TASK_STATUSES = new Set(['pending', 'acknowledged', 'in_progress']);
const TASK_DELIVERY_FIELDS = [
  'acknowledgedAt',
  'startedAt',
  'deliveryFailure',
  'sessionPolicyConsumedAt',
] as const;

const RETAINED_SCHEDULED_PROMPT_REASONS = new Set(['completed', 'failed']);

/** The field-rule map of one exported table. */
type FieldRules = ReturnType<typeof rulesOf>;

// ---------------------------------------------------------------------------
// validateExportFile
// ---------------------------------------------------------------------------

/**
 * Validates a file's text. Refusal order is fixed so the first thing wrong with
 * a file is the thing the user is told: JSON, kind, version, checksum, shape,
 * duplicate keys, dangling refs.
 */
export async function validateExportFile(json: string): Promise<ImportValidation> {
  const parsed = parseJson(json);
  if (!parsed.ok) return parsed.failure;
  return validateExportValue(parsed.value);
}

/**
 * The ordered checks on an already-parsed value: header, checksum, then row
 * integrity. Shared with the offline bundle listing, which validates one
 * payload at a time without re-serializing it.
 */
export async function validateExportValue(value: unknown): Promise<ImportValidation> {
  const header = exportHeader(value);
  if (!header.ok) return header.failure;

  const checksumFailure = await checksumFailureOf(header.file);
  if (checksumFailure) return checksumFailure;

  const rowsFailure = rowFailureOf(header.file);
  if (rowsFailure) return rowsFailure;

  return { ok: true, file: header.file as unknown as ChatroomExportFileV1 };
}

type ExportHeader =
  { ok: true; file: Record<string, unknown> } | { ok: false; failure: ImportFailure };

function exportHeader(value: unknown): ExportHeader {
  if (!isPlainObject(value) || value.kind !== CHATROOM_EXPORT_KIND) {
    return {
      ok: false,
      failure: failure(
        TRANSFER_ERROR_CODES.IMPORT_NOT_AN_EXPORT,
        'This file is not a chatroom export.'
      ),
    };
  }
  if (value.formatVersion !== CHATROOM_EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      failure: failure(
        TRANSFER_ERROR_CODES.IMPORT_UNSUPPORTED_VERSION,
        `This export file has format version ${String(value.formatVersion)}; this app reads version ${CHATROOM_EXPORT_FORMAT_VERSION}.`
      ),
    };
  }
  return { ok: true, file: value };
}

async function checksumFailureOf(
  file: Record<string, unknown>
): Promise<ImportFailure | undefined> {
  const checksum = await contentChecksum(file);
  if (checksum === undefined) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
      'The file is not a readable chatroom export.'
    );
  }
  if (checksum !== file.checksum) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_CHECKSUM_MISMATCH,
      'The file content does not match its checksum; it changed after export.'
    );
  }
  return undefined;
}

function rowFailureOf(file: Record<string, unknown>): ImportFailure | undefined {
  const shape = shapeProblems(file);
  if (shape.length > 0) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
      'The file is not a readable chatroom export.',
      shape
    );
  }

  const duplicates = duplicateKeyProblems(file);
  if (duplicates.length > 0) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
      'The file has duplicate row keys; every row key must be unique.',
      duplicates
    );
  }

  const dangling = danglingReferences(file);
  if (dangling.length > 0) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_DANGLING_REFERENCE,
      'The file references rows it does not contain; it cannot be imported as-is.',
      dangling
    );
  }
  return undefined;
}

type ParsedJson = { ok: true; value: unknown } | { ok: false; failure: ImportFailure };

/**
 * The checksum of the twelve content properties, or `undefined` when the content
 * cannot be canonicalised (a non-finite number, for example). `JSON.parse` can
 * produce `Infinity` from `1e400`, so a malformed file must not escape as a throw.
 */
async function contentChecksum(file: Record<string, unknown>): Promise<string | undefined> {
  try {
    return await sha256Hex(canonicalJson(contentOf(file as unknown as ChatroomExportContent)));
  } catch {
    return undefined;
  }
}

function parseJson(json: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(json) as unknown };
  } catch {
    return {
      ok: false,
      failure: failure(TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE, 'The file is not valid JSON.'),
    };
  }
}

function failure(code: TransferErrorCode, message: string, details: string[] = []): ImportFailure {
  return { ok: false, code, message, details };
}

/** Shared with the offline listing so "plain export object" means one thing. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Step 5: the room row and every content row carry the fields the plan reads. */
function shapeProblems(file: Record<string, unknown>): string[] {
  const problems: string[] = [];
  checkRoomShape(file.room, problems);
  for (const category of CONTENT_CATEGORIES) {
    const rows = file[category];
    if (!Array.isArray(rows)) {
      problems.push(category);
      continue;
    }
    rows.forEach((row, index) => checkRowShape(row, `${category}[${index}]`, problems));
  }
  return problems;
}

interface RoomFieldCheck {
  path: string;
  passes: (room: Record<string, unknown>) => boolean;
}

/** Every required room field, with the path the report names when it fails. */
const ROOM_FIELD_CHECKS: readonly RoomFieldCheck[] = [
  { path: 'room._key', passes: (room) => typeof room._key === 'string' },
  { path: 'room._creationTime', passes: (room) => typeof room._creationTime === 'number' },
  {
    path: 'room.status',
    passes: (room) => room.status === 'active' || room.status === 'completed',
  },
  {
    path: 'room.teamStructureId',
    passes: (room) => typeof room.teamStructureId === 'string' && room.teamStructureId.length > 0,
  },
  {
    path: 'room.primaryWorkspaceKey',
    passes: (room) =>
      room.primaryWorkspaceKey === undefined || typeof room.primaryWorkspaceKey === 'string',
  },
];

function checkRoomShape(room: unknown, problems: string[]): void {
  if (!isPlainObject(room)) {
    problems.push('room');
    return;
  }
  for (const check of ROOM_FIELD_CHECKS) {
    if (!check.passes(room)) problems.push(check.path);
  }
}

function checkRowShape(row: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(row)) {
    problems.push(path);
    return;
  }
  if (typeof row._key !== 'string') problems.push(`${path}._key`);
  if (typeof row._creationTime !== 'number') problems.push(`${path}._creationTime`);
}

/**
 * Every content row with the table it will be written to. The room category
 * merges three tables, so it maps to `chatroom_rooms` and its workspace pointer
 * is checked explicitly instead of through registry ref rules.
 */
function* keyedRows(file: Record<string, unknown>): Generator<{ table: string; row: ExportRow }> {
  yield { table: ROOM_TABLE, row: file.room as ExportRow };
  for (const category of CONTENT_CATEGORIES) {
    const table = exportedEntryFor(category).table;
    for (const row of file[category] as ExportRow[]) yield { table, row };
  }
}

/** Step 6: a key that appears twice across all content rows, room included. */
function duplicateKeyProblems(file: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { table, row } of keyedRows(file)) {
    if (seen.has(row._key)) problems.push(`${table}.${row._key}`);
    else seen.add(row._key);
  }
  return problems;
}

/** Step 7: every registry ref (and the room's primary workspace pointer) must resolve. */
function danglingReferences(file: Record<string, unknown>): string[] {
  const keysByTable = collectKeys(file);
  const problems = CONTENT_CATEGORIES.flatMap((category) =>
    danglingInCategory(category, file, keysByTable)
  );
  const primary = primaryWorkspaceProblem(file, keysByTable);
  return primary === undefined ? problems : [...problems, primary];
}

function danglingInCategory(
  category: NonRoomCategory,
  file: Record<string, unknown>,
  keysByTable: Map<string, Set<string>>
): string[] {
  const table = exportedEntryFor(category).table;
  const rules = rulesOf(table);
  return (file[category] as ExportRow[]).flatMap((row) =>
    danglingInRow(table, row, rules, keysByTable)
  );
}

function danglingInRow(
  table: string,
  row: ExportRow,
  rules: FieldRules,
  keysByTable: Map<string, Set<string>>
): string[] {
  const problems: string[] = [];
  for (const [field, value] of Object.entries(row)) {
    const rule = rules[field];
    if (!isRefRule(rule)) continue;
    const targets = keysFor(keysByTable, rule.table);
    problems.push(...refValueProblems(table, field, value, targets));
  }
  return problems;
}

type RefRule = Extract<FieldRules[string], { rule: 'ref' }>;

function isRefRule(rule: FieldRules[string]): rule is RefRule {
  return rule?.rule === 'ref';
}

function keysFor(keysByTable: Map<string, Set<string>>, table: string): ReadonlySet<string> {
  return keysByTable.get(table) ?? new Set<string>();
}

function refValueProblems(
  table: string,
  field: string,
  value: unknown,
  targets: ReadonlySet<string>
): string[] {
  return refValues(value)
    .filter((key) => !targets.has(key))
    .map((key) => `${table}.${field} → ${key}`);
}

function primaryWorkspaceProblem(
  file: Record<string, unknown>,
  keysByTable: Map<string, Set<string>>
): string | undefined {
  const primary = (file.room as ExportRow).primaryWorkspaceKey;
  if (typeof primary !== 'string') return undefined;
  if (keysByTable.get(WORKSPACES_TABLE)?.has(primary)) return undefined;
  return `${PRIMARY_WORKSPACES_TABLE}.workspaceId → ${primary}`;
}

/** Keys present in the file, grouped by the table the plan will write them to. */
function collectKeys(file: Record<string, unknown>): Map<string, Set<string>> {
  const keysByTable = new Map<string, Set<string>>();
  for (const { table, row } of keyedRows(file)) {
    const keys = keysByTable.get(table) ?? new Set<string>();
    keys.add(row._key);
    keysByTable.set(table, keys);
  }
  return keysByTable;
}

/** A ref value is one key or an array of keys; anything else is still reported as a miss. */
function refValues(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [String(value)];
}

// ---------------------------------------------------------------------------
// buildImportPlan
// ---------------------------------------------------------------------------

/**
 * Builds the deterministic import plan. Refusals that make the whole file
 * unusable come first; everything else is a transform recorded in the report.
 */
export function buildImportPlan(
  file: ChatroomExportFileV1,
  target: ImportTarget
): ImportPlanResult {
  const refusal = planRefusal(file, target);
  if (refusal) return refusal;

  const collapse = collapseWorkspaces(file.workspaces);
  const ctx = emptyTransformContext(collapse.survivorOf);
  const rows = planAllRows(file, ctx, target, collapse.rows);
  return { ok: true, plan: assemblePlan(file, target, collapse, ctx, rows) };
}

/** Refusals that make the whole file unusable, before any row work. */
function planRefusal(file: ChatroomExportFileV1, target: ImportTarget): ImportFailure | undefined {
  if (!target.teamStructureKnown) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_UNKNOWN_TEAM_STRUCTURE,
      'The file was exported from a team structure this deployment does not know.',
      [String(file.room.teamStructureId)]
    );
  }
  if (target.invalidWorkingDirs.length > 0) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_INVALID_WORKING_DIR,
      'The file has working directories that are not valid on this machine; the whole file is refused.',
      [...target.invalidWorkingDirs]
    );
  }
  return undefined;
}

function emptyTransformContext(survivorOf: Map<string, string>): TransformContext {
  return { survivorOf, tasksReset: 0, agentConfigsRestored: 0, agentConfigsSkipped: [] };
}

/** Every category's rows in file order; workspaces come from the collapse. */
function planAllRows(
  file: ChatroomExportFileV1,
  ctx: TransformContext,
  target: ImportTarget,
  workspaceRows: ImportRowPayload[]
): Record<NonRoomCategory, ImportRowPayload[]> {
  const rows = { workspaces: workspaceRows } as Record<NonRoomCategory, ImportRowPayload[]>;
  for (const category of CONTENT_CATEGORIES) {
    if (category === 'workspaces') continue;
    rows[category] = planCategory(category, file, ctx, target);
  }
  return rows;
}

function assemblePlan(
  file: ChatroomExportFileV1,
  target: ImportTarget,
  collapse: WorkspaceCollapse,
  ctx: TransformContext,
  rows: Record<NonRoomCategory, ImportRowPayload[]>
): ImportPlan {
  const primaryKey = primaryWorkspaceKeyOf(file.room.primaryWorkspaceKey, collapse.survivorOf);
  const drafts = buildChunkDrafts(rows);
  const patches = deferRefs(drafts);

  return {
    header: headerOf(file.room),
    finalize: {
      status: roomStatus(file.room),
      lastActivityAt:
        typeof file.room.lastActivityAt === 'number' ? file.room.lastActivityAt : null,
      nextQueuePosition: queuePositionAfter(file.room, rows.tasks, rows.messageQueue),
    },
    chunks: assembleChunks(drafts, chunkItems(patches), primaryKey, target.machineId),
    report: {
      counts: countsOf(rows, ctx.agentConfigsRestored),
      merged: collapse.merged,
      agentConfigsRestored: ctx.agentConfigsRestored,
      agentConfigsSkipped: ctx.agentConfigsSkipped,
      tasksReset: ctx.tasksReset,
      scheduledPromptsDisabled: file.scheduledPrompts.length,
      messageTimesNotPreserved: true,
    },
  };
}

interface TransformContext {
  survivorOf: Map<string, string>;
  tasksReset: number;
  agentConfigsRestored: number;
  agentConfigsSkipped: { key: string; reason: AgentConfigSkipReason }[];
}

function planCategory(
  category: NonRoomCategory,
  file: ChatroomExportFileV1,
  ctx: TransformContext,
  target: ImportTarget
): ImportRowPayload[] {
  if (category === 'agentConfigs') return planAgentConfigs(file, ctx, target);

  const { table } = exportedEntryFor(category);
  return file[category].map((row) => ({
    key: row._key,
    fields: transformFields(table, category, row, ctx),
  }));
}

// ---------------------------------------------------------------------------
// Workspace collapse
// ---------------------------------------------------------------------------

interface WorkspaceCollapse {
  survivorOf: Map<string, string>;
  rows: ImportRowPayload[];
  merged: { workingDir: string; keys: string[] }[];
}

interface WorkspaceGroup {
  keys: string[];
  fileTreeSync: boolean;
}

/**
 * Groups workspaces by normalized working directory. The first key in a group
 * survives; every key maps to its survivor so refs can be rewritten.
 * `fileTreeSyncEnabled` survives if any member enabled it.
 */
function collapseWorkspaces(workspaces: ExportRow[]): WorkspaceCollapse {
  const groups = groupWorkspaces(workspaces);
  const survivorOf = new Map<string, string>();
  const rows: ImportRowPayload[] = [];
  const merged: { workingDir: string; keys: string[] }[] = [];

  for (const [workingDir, group] of groups) {
    addCollapsedGroup(workingDir, group, survivorOf, rows, merged);
  }

  return { survivorOf, rows, merged };
}

function groupWorkspaces(workspaces: ExportRow[]): Map<string, WorkspaceGroup> {
  const groups = new Map<string, WorkspaceGroup>();
  for (const row of workspaces) {
    const groupKey = normalizeWorkingDir(workingDirOf(row));
    const group = groups.get(groupKey) ?? { keys: [], fileTreeSync: false };
    group.keys.push(row._key);
    group.fileTreeSync = group.fileTreeSync || row.fileTreeSyncEnabled === true;
    groups.set(groupKey, group);
  }
  return groups;
}

function workingDirOf(row: ExportRow): string {
  return typeof row.workingDir === 'string' ? row.workingDir : '';
}

function addCollapsedGroup(
  workingDir: string,
  group: WorkspaceGroup,
  survivorOf: Map<string, string>,
  rows: ImportRowPayload[],
  merged: { workingDir: string; keys: string[] }[]
): void {
  const survivor = group.keys[0];
  if (survivor === undefined) return;
  for (const key of group.keys) survivorOf.set(key, survivor);
  rows.push({
    key: survivor,
    fields: { workingDir, fileTreeSyncEnabled: group.fileTreeSync },
  });
  if (group.keys.length > 1) merged.push({ workingDir, keys: [...group.keys] });
}

function primaryWorkspaceKeyOf(
  primaryWorkspaceKey: unknown,
  survivorOf: Map<string, string>
): string | null {
  if (typeof primaryWorkspaceKey !== 'string') return null;
  return survivorOf.get(primaryWorkspaceKey) ?? null;
}

// ---------------------------------------------------------------------------
// Row transforms
// ---------------------------------------------------------------------------

/**
 * Keeps only the fields the import may write: registry `copy`, `ref` and `reset`
 * rules, plus the messages' pass-through handoff role. `_key`, `_creationTime`
 * and the informational `sourceMachineId` have no registry rule, so they are
 * skipped with every other unknown field.
 */
function transformFields(
  table: string,
  category: NonRoomCategory,
  row: ExportRow,
  ctx: TransformContext
): Record<string, unknown> {
  const fields = copyAllowedFields(table, row, ctx.survivorOf);
  applyCategoryTransform(category, fields, row, ctx);
  return fields;
}

type FieldAction = 'skip' | 'keep' | 'ref';

function copyAllowedFields(
  table: string,
  row: ExportRow,
  survivorOf: Map<string, string>
): Record<string, unknown> {
  const rules = rulesOf(table);
  const fields: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row)) {
    const action = fieldAction(table, field, rules[field]);
    if (action === 'skip') continue;
    fields[field] = action === 'ref' ? rewriteWorkspaceRef(value, survivorOf) : value;
  }
  return fields;
}

function fieldAction(table: string, field: string, rule: FieldRules[string]): FieldAction {
  if (table === MESSAGES_TABLE && field === HANDOFF_ROLE_FIELD) return 'keep';
  return ruleAction(rule);
}

/** One decision per registry rule; only `copy`, `reset` and `ref` are written on import. */
const FIELD_ACTIONS: Readonly<Record<FieldRules[string]['rule'], FieldAction>> = {
  copy: 'keep',
  reset: 'keep',
  ref: 'ref',
  rebind: 'skip',
  derive: 'skip',
  system: 'skip',
  drop: 'skip',
};

function ruleAction(rule: FieldRules[string]): FieldAction {
  return rule === undefined ? 'skip' : FIELD_ACTIONS[rule.rule];
}

function applyCategoryTransform(
  category: NonRoomCategory,
  fields: Record<string, unknown>,
  row: ExportRow,
  ctx: TransformContext
): void {
  if (category === 'tasks') applyTaskReset(fields, row, ctx);
  if (category === 'scheduledPrompts') applyScheduledPromptTransform(fields, row);
}

/** Refs to merged-away workspaces point at the survivor; every other key is unchanged. */
function rewriteWorkspaceRef(value: unknown, survivorOf: Map<string, string>): unknown {
  if (typeof value === 'string') return survivorOf.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === 'string' ? (survivorOf.get(entry) ?? entry) : entry
    );
  }
  return value;
}

/**
 * Non-terminal tasks return to `pending` and lose their delivery state. A task
 * counts as reset when its status was acknowledged/in_progress, or when it was
 * pending but still carried delivery fields. Terminal statuses are verbatim.
 */
function applyTaskReset(
  fields: Record<string, unknown>,
  row: ExportRow,
  ctx: TransformContext
): void {
  if (!isNonTerminalTaskStatus(row.status)) return;

  if (countsAsReset(row)) ctx.tasksReset += 1;

  fields.status = 'pending';
  clearDeliveryFields(fields);
}

function isNonTerminalTaskStatus(status: unknown): boolean {
  return typeof status === 'string' && NON_TERMINAL_TASK_STATUSES.has(status);
}

/** Acknowledge/start fields on a pending task are stale delivery state, not history. */
function countsAsReset(row: ExportRow): boolean {
  return row.status !== 'pending' || hasDeliveryState(row);
}

function hasDeliveryState(row: ExportRow): boolean {
  return TASK_DELIVERY_FIELDS.some((field) => row[field] !== undefined && row[field] !== null);
}

function clearDeliveryFields(fields: Record<string, unknown>): void {
  for (const field of TASK_DELIVERY_FIELDS) delete fields[field];
}

/** Imported prompts never fire until reviewed; only a completed/failed reason survives. */
function applyScheduledPromptTransform(fields: Record<string, unknown>, row: ExportRow): void {
  fields.isRunnable = false;
  fields.disabledReason =
    typeof row.disabledReason === 'string' &&
    RETAINED_SCHEDULED_PROMPT_REASONS.has(row.disabledReason)
      ? row.disabledReason
      : 'user';
}

// ---------------------------------------------------------------------------
// Agent configs
// ---------------------------------------------------------------------------

/**
 * One restored launch configuration per (surviving workspace, role). Rows are
 * checked in a fixed order — no workspace, working dir mismatch, wrong type,
 * empty model, unavailable harness — then the last row per group wins and
 * earlier ones are reported as superseded by the workspace merge.
 */
function planAgentConfigs(
  file: ChatroomExportFileV1,
  ctx: TransformContext,
  target: ImportTarget
): ImportRowPayload[] {
  const workspaceKeys = new Set(file.workspaces.map((row) => row._key));
  const workspaceDirs = new Map(
    file.workspaces.map((row) => [row._key, normalizeWorkingDir(workingDirOf(row))] as const)
  );
  const decisions = file.agentConfigs.map((row) => {
    const survivor =
      typeof row.workspaceId === 'string' ? ctx.survivorOf.get(row.workspaceId) : undefined;
    const facts: AgentConfigFacts = { row, survivor, workspaceKeys, workspaceDirs, target };
    return { row, survivor, reason: agentConfigSkipReason(facts) };
  });

  const lastIndexByGroup = new Map<string, number>();
  decisions.forEach((decision, index) => {
    if (decision.reason || decision.survivor === undefined) return;
    lastIndexByGroup.set(agentConfigGrouping(decision.survivor, decision.row.role), index);
  });

  const kept: ImportRowPayload[] = [];
  decisions.forEach((decision, index) => {
    if (decision.reason) {
      ctx.agentConfigsSkipped.push({ key: decision.row._key, reason: decision.reason });
      return;
    }
    const survivor = decision.survivor as string;
    if (lastIndexByGroup.get(agentConfigGrouping(survivor, decision.row.role)) !== index) {
      ctx.agentConfigsSkipped.push({ key: decision.row._key, reason: 'superseded_by_merge' });
      return;
    }
    kept.push({ key: decision.row._key, fields: agentConfigFields(decision.row, survivor) });
  });

  ctx.agentConfigsRestored = kept.length;
  return kept;
}

interface AgentConfigFacts {
  row: ExportRow;
  survivor: string | undefined;
  workspaceKeys: Set<string>;
  workspaceDirs: ReadonlyMap<string, string>;
  target: ImportTarget;
}

interface AgentConfigCheck {
  reason: AgentConfigSkipReason;
  passes: (facts: AgentConfigFacts) => boolean;
}

/** The first failing check is the reason a row reports, so order is the contract. */
const AGENT_CONFIG_CHECKS: readonly AgentConfigCheck[] = [
  {
    reason: 'no_workspace',
    passes: ({ survivor, workspaceKeys }) => survivor !== undefined && workspaceKeys.has(survivor),
  },
  {
    reason: 'working_dir_mismatch',
    passes: ({ row, survivor, workspaceDirs }) =>
      survivor !== undefined &&
      typeof row.workingDir === 'string' &&
      normalizeWorkingDir(row.workingDir) === workspaceDirs.get(survivor),
  },
  { reason: 'non_remote_agent_type', passes: ({ row }) => row.agentType === 'remote' },
  {
    reason: 'empty_model',
    passes: ({ row }) => typeof row.model === 'string' && row.model.trim() !== '',
  },
  {
    reason: 'harness_unavailable',
    passes: ({ row, target }) =>
      typeof row.agentHarness === 'string' && target.availableHarnesses.includes(row.agentHarness),
  },
];

function agentConfigSkipReason(facts: AgentConfigFacts): AgentConfigSkipReason | undefined {
  return AGENT_CONFIG_CHECKS.find((check) => !check.passes(facts))?.reason;
}

function agentConfigGrouping(workspaceId: string, role: unknown): string {
  return `${workspaceId}\u0000${String(role)}`;
}

function agentConfigFields(row: ExportRow, workspaceId: string): Record<string, unknown> {
  return {
    role: row.role,
    agentType: row.agentType,
    agentHarness: row.agentHarness,
    model: row.model,
    workingDir: row.workingDir,
    workspaceId,
  };
}

// ---------------------------------------------------------------------------
// Queue position
// ---------------------------------------------------------------------------

/** One past the highest task or queued-message position, never below the room's value. */
function queuePositionAfter(
  room: ExportRow,
  tasks: ImportRowPayload[],
  messageQueue: ImportRowPayload[]
): number {
  const candidates = [typeof room.nextQueuePosition === 'number' ? room.nextQueuePosition : 0, 0];
  for (const row of [...tasks, ...messageQueue]) {
    const position = row.fields.queuePosition;
    if (typeof position === 'number') candidates.push(position + 1);
  }
  return Math.max(...candidates);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

interface ChunkDraft {
  phase: NonLinkPhase;
  rows: ImportRowPayload[];
}

function buildChunkDrafts(rows: Record<NonRoomCategory, ImportRowPayload[]>): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  for (const phase of PHASE_ORDER) {
    for (const chunk of chunkItems(rows[phase])) drafts.push({ phase, rows: chunk });
  }
  return drafts;
}

/**
 * Removes every ref field that a later (or same) chunk would need and merges the
 * removals into one patch per row.
 *
 * Chunk indices are provisional: they ignore the `links` chunks that this step
 * creates. Links are inserted after `messageQueue`, and no ref target lives in a
 * later phase, so the relative order the comparison needs is unchanged.
 */
function deferRefs(drafts: ChunkDraft[]): LinkPatch[] {
  const chunkIndexByKey = new Map<string, number>();
  drafts.forEach((draft, chunkIndex) => {
    for (const row of draft.rows) chunkIndexByKey.set(row.key, chunkIndex);
  });

  const patches: LinkPatch[] = [];
  drafts.forEach((draft, chunkIndex) => {
    const table = exportedEntryFor(draft.phase).table;
    const rules = rulesOf(table);
    for (const row of draft.rows) {
      const deferred = deferredFields(row, rules, chunkIndex, chunkIndexByKey);
      if (Object.keys(deferred).length === 0) continue;
      patches.push({ table: linkPatchTable(draft.phase), key: row.key, fields: deferred });
    }
  });
  return patches;
}

function deferredFields(
  row: ImportRowPayload,
  rules: FieldRules,
  chunkIndex: number,
  chunkIndexByKey: Map<string, number>
): Record<string, string | string[]> {
  const deferred: Record<string, string | string[]> = {};
  for (const [field, rule] of Object.entries(rules)) {
    if (!shouldDefer(row, field, rule, chunkIndex, chunkIndexByKey)) continue;
    deferred[field] = row.fields[field] as string | string[];
    delete row.fields[field];
  }
  // The handoff role derives the message's key from the origin's new id, so it
  // travels with the origin link. A role whose origin is immediate stays on the row.
  moveHandoffRole(row, deferred);
  return deferred;
}

/** The role can only be resolved once the origin's new id exists. */
function moveHandoffRole(row: ImportRowPayload, deferred: Record<string, string | string[]>): void {
  const role = row.fields[HANDOFF_ROLE_FIELD];
  if (deferred.taskOriginMessageId !== undefined && typeof role === 'string') {
    deferred[HANDOFF_ROLE_FIELD] = role;
    delete row.fields[HANDOFF_ROLE_FIELD];
  }
}

function shouldDefer(
  row: ImportRowPayload,
  field: string,
  rule: FieldRules[string],
  chunkIndex: number,
  chunkIndexByKey: Map<string, number>
): boolean {
  if (rule?.rule !== 'ref') return false;
  const value = row.fields[field];
  return value !== undefined && isDeferred(value, chunkIndex, chunkIndexByKey);
}

/** Kept only when every target is in a strictly earlier chunk. */
function isDeferred(
  value: unknown,
  chunkIndex: number,
  chunkIndexByKey: Map<string, number>
): boolean {
  for (const key of refKeys(value)) {
    const targetChunk = chunkIndexByKey.get(key);
    if (targetChunk === undefined) {
      throw new Error(`Chatroom import plan: reference ${key} has no planned row`);
    }
    if (targetChunk >= chunkIndex) return true;
  }
  return false;
}

function refKeys(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry !== 'string') {
        throw new Error('Chatroom import plan: a ref array holds a non-string value');
      }
      return entry;
    });
  }
  throw new Error(`Chatroom import plan: a ref value is ${typeof value}`);
}

/** Only messages, tasks and artifacts can carry deferred refs (B2). */
function linkPatchTable(phase: NonLinkPhase): LinkPatch['table'] {
  if (phase === 'messages' || phase === 'tasks' || phase === 'artifacts') return phase;
  throw new Error(
    `Chatroom import plan: ${exportedEntryFor(phase).table} cannot carry a deferred reference`
  );
}

/**
 * Splits items at the row and byte caps. The running byte count mirrors
 * `JSON.stringify`: `[` + items joined by `,` + `]`, so it is 2 + the item bytes
 * + one byte per separator. A single item over the cap becomes its own chunk.
 */
function chunkItems<T>(items: T[]): T[][] {
  const state: ChunkState<T> = { chunks: [], rows: [], bytes: EMPTY_ARRAY_BYTES };
  for (const item of items) appendChunkItem(state, item);
  closeChunk(state);
  return state.chunks;
}

const EMPTY_ARRAY_BYTES = 2; // "[]"

interface ChunkState<T> {
  chunks: T[][];
  rows: T[];
  bytes: number;
}

function appendChunkItem<T>(state: ChunkState<T>, item: T): void {
  const itemBytes = byteLength(item);
  if (chunkOverflows(state, itemBytes)) closeChunk(state);
  state.bytes += separatorBytes(state) + itemBytes;
  state.rows.push(item);
}

function chunkOverflows<T>(state: ChunkState<T>, itemBytes: number): boolean {
  return (
    state.rows.length >= IMPORT_CHUNK_MAX_ROWS ||
    (state.rows.length > 0 && state.bytes + 1 + itemBytes > IMPORT_CHUNK_MAX_BYTES)
  );
}

function separatorBytes<T>(state: ChunkState<T>): number {
  return state.rows.length > 0 ? 1 : 0;
}

function closeChunk<T>(state: ChunkState<T>): void {
  if (state.rows.length === 0) return;
  state.chunks.push(state.rows);
  state.rows = [];
  state.bytes = EMPTY_ARRAY_BYTES;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Chunks in their final order: phases before `links`, the link chunks, then the rest. */
function assembleChunks(
  drafts: ChunkDraft[],
  linkChunks: LinkPatch[][],
  primaryKey: string | null,
  machineId: string
): ImportChunk[] {
  const splitAt = linksSplitIndex(drafts);
  return [
    ...drafts.slice(0, splitAt).map((draft) => toImportChunk(draft, primaryKey, machineId)),
    ...linkChunks.map(toLinkChunk),
    ...drafts.slice(splitAt).map((draft) => toImportChunk(draft, primaryKey, machineId)),
  ];
}

function linksSplitIndex(drafts: ChunkDraft[]): number {
  const index = drafts.findIndex((draft) => PHASES_AFTER_LINKS.includes(draft.phase));
  return index === -1 ? drafts.length : index;
}

function toLinkChunk(patches: LinkPatch[]): ImportChunk {
  return { phase: 'links', patches, refs: {} };
}

function toImportChunk(
  draft: ChunkDraft,
  primaryKey: string | null,
  machineId: string
): ImportChunk {
  if (draft.phase === 'workspaces') {
    return workspaceChunk(draft.rows, primaryKey, machineId);
  }
  if (draft.phase === 'agentConfigs') {
    return { phase: 'agentConfigs', machineId, rows: draft.rows, refs: {} };
  }
  return { phase: draft.phase, rows: draft.rows, refs: {} };
}

function workspaceChunk(
  rows: ImportRowPayload[],
  primaryKey: string | null,
  machineId: string
): ImportChunk {
  const holdsPrimary = primaryKey !== null && rows.some((row) => row.key === primaryKey);
  return {
    phase: 'workspaces',
    machineId,
    rows,
    primaryKey: holdsPrimary ? primaryKey : null,
    refs: {},
  };
}

// ---------------------------------------------------------------------------
// Header, finalize and report helpers
// ---------------------------------------------------------------------------

const HEADER_STRING_FIELDS = ['name', 'standingInstructions', 'standingInstructionsTitle'] as const;

function headerOf(room: ExportRow): ImportHeader {
  const header: ImportHeader = { teamStructureId: String(room.teamStructureId) };
  for (const field of HEADER_STRING_FIELDS) {
    const value = room[field];
    if (typeof value === 'string') header[field] = value;
  }
  if (typeof room.standingInstructionsEnabled === 'boolean') {
    header.standingInstructionsEnabled = room.standingInstructionsEnabled;
  }
  return header;
}

function roomStatus(room: ExportRow): 'active' | 'completed' {
  return room.status === 'completed' ? 'completed' : 'active';
}

function countsOf(
  rows: Record<NonRoomCategory, ImportRowPayload[]>,
  agentConfigs: number
): Record<string, number> {
  const counts: Record<string, number> = { room: 1 };
  for (const category of CONTENT_CATEGORIES) {
    counts[category] = category === 'agentConfigs' ? agentConfigs : rows[category].length;
  }
  return counts;
}
