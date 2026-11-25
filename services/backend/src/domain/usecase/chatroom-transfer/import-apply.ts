/**
 * Chatroom import — apply core.
 *
 * The plan (`import-plan.ts`) hands the driver a flat list of chunks. A chunk is
 * the unit of one transactional apply: every row in a chunk references only
 * rows in strictly earlier chunks (or rows patched later through `links`), so a
 * chunk can be written without waiting for a later one.
 *
 * `refs` maps a **file key** to the id the target deployment assigned to that
 * row. The planner emits an empty map; the driver fills it after each apply, so
 * a later chunk can translate the file's keys into target ids.
 *
 * `links` chunks carry deferred cross-chunk references: the planner removes a
 * whole ref field from its row and patches it once its targets exist. Array
 * fields are deferred whole, never split.
 *
 * ## Import guard
 *
 * A room is importable only while it is `completed`, owned by the caller and
 * younger than `IMPORT_WINDOW_MS`. `beginImport` creates the room through the
 * normal chatroom path and immediately archives it, so no active list shows a
 * half-imported room. `finalizeImport` flips the status; a second finalize is
 * refused because the room is no longer `completed`.
 *
 * ## Rollback
 *
 * Rollback deletes in `ROLLBACK_ORDER` within `IMPORT_ROLLBACK_BUDGET`, using
 * the registry descriptors rather than scanning. The room row goes last, and
 * only after every other table returned fewer rows than the batch asked for.
 */

import { ConvexError } from 'convex/values';

import {
  CHATROOM_SCOPED_TABLES,
  ROLLBACK_ORDER,
  type FieldRule,
  type RollbackDescriptor,
} from './registry';
import { exportedEntryFor, rulesOf } from './registry-lookup';
import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import type { Id, Doc, TableNames } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { IMPORT_ROLLBACK_BUDGET, IMPORT_WINDOW_MS } from '../../entities/chatroom-transfer-file';
import { getTeamPreset } from '../../entities/team-presets';
import { insertChatroomWithTeam } from '../chatroom/create-chatroom';
import { upsertReadCursor } from '../chatroom/read-cursor';
import { clearChatroomUnread } from '../chatroom/unread-status';
import { insertChatroomMessage, syncMessageReadModel } from '../message/message-read-model';
import { syncActiveTaskHeader } from '../task/active-task-header';
import { adjustTaskCount, statusToCountField, type TaskCountField } from '../task/task-counts';
import { writeTaskStatusSignals } from '../task/write-task-status-signals';
import { insertInitialPrimaryWorkspace } from '../workspace/insert-initial-primary-workspace';
import { registerWorkspace } from '../workspace/register-workspace';

export type ImportTable =
  | 'workspaces'
  | 'artifacts'
  | 'backlog'
  | 'scheduledPrompts'
  | 'messages'
  | 'tasks'
  | 'contexts'
  | 'messageQueue'
  | 'links'
  | 'savedCommands'
  | 'skillCustomizations'
  | 'agentConfigs';

/** Room-level values the import writes onto the new chatroom. */
export interface ImportHeader {
  teamStructureId: string;
  name?: string;
  standingInstructions?: string;
  standingInstructionsEnabled?: boolean;
  standingInstructionsTitle?: string;
}

/** `key` is the file's `_key`. `fields` holds registry copy/ref/reset values; ref values are file keys. */
export interface ImportRowPayload {
  key: string;
  fields: Record<string, unknown>;
}

/** Tables whose rows the `links` phase may patch (B2: artifacts included for version links). */
export type LinkPatchTable = 'messages' | 'tasks' | 'artifacts';

/** One row's deferred ref fields, applied after the target rows exist. */
export interface LinkPatch {
  table: LinkPatchTable;
  key: string;
  fields: Record<string, string | string[]>;
}

export type ImportChunk =
  | {
      phase: 'workspaces';
      machineId: string;
      rows: ImportRowPayload[];
      primaryKey: string | null;
      refs: Record<string, string>;
    }
  | {
      phase: 'agentConfigs';
      machineId: string;
      rows: ImportRowPayload[];
      refs: Record<string, string>;
    }
  | {
      phase: Exclude<ImportTable, 'links' | 'workspaces' | 'agentConfigs'>;
      rows: ImportRowPayload[];
      refs: Record<string, string>;
    }
  | { phase: 'links'; patches: LinkPatch[]; refs: Record<string, string> };

// ---------------------------------------------------------------------------
// Public apply functions
// ---------------------------------------------------------------------------

/** Messages carry the source key's role instead of the derived key. */
const HANDOFF_ROLE_FIELD = 'terminalHandoffRole';

/** Mirrors `services/backend/convex/messages.ts`: `<chatroomId>:<originMessageId>:<role>:user`. */
export function terminalHandoffKeyOf(chatroomId: string, originId: string, role: string): string {
  return `${chatroomId}:${originId}:${role}:user`;
}

export async function beginImport(
  ctx: MutationCtx,
  a: { ownerId: Id<'users'>; header: ImportHeader; machineId: string }
): Promise<{ chatroomId: Id<'chatroom_rooms'> }> {
  if (!getTeamPreset(a.header.teamStructureId)) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.IMPORT_UNKNOWN_TEAM_STRUCTURE,
      message: 'This deployment does not know the exported team structure',
    });
  }

  const machine = await findMachine(ctx, a.machineId);
  if (!machine) throw machineNotFound();

  const chatroomId = await insertChatroomWithTeam(ctx, {
    ownerId: a.ownerId,
    teamStructureId: a.header.teamStructureId,
    ...(a.header.name === undefined ? {} : { name: a.header.name }),
  });

  // Archive immediately so the room never appears in an active list while chunks land.
  await ctx.db.patch('chatroom_rooms', chatroomId, {
    status: 'completed',
    ...standingInstructionFields(a.header),
  });

  return { chatroomId };
}

export async function applyImportChunk(
  ctx: MutationCtx,
  a: { ownerId: Id<'users'>; chatroomId: Id<'chatroom_rooms'>; chunk: ImportChunk }
): Promise<{ created: Record<string, string> }> {
  await loadImportingRoom(ctx, a.ownerId, a.chatroomId);

  const chunk = a.chunk as unknown;
  const phase = phaseOf(chunk);
  if (!isSupportedPhase(phase)) throw chunkFailure('phase not yet supported');
  assertChunkEnvelope(chunk);

  return { created: await applySupportedChunk(ctx, a, phase, chunk) };
}

/** Dispatches a validated chunk. `agentConfigs` is refused above until P8b. */
async function applySupportedChunk(
  ctx: MutationCtx,
  a: { ownerId: Id<'users'>; chatroomId: Id<'chatroom_rooms'> },
  phase: SupportedPhase,
  chunk: LeafChunk | WorkspacesChunk | LinksChunk
): Promise<Record<string, string>> {
  if (phase === 'workspaces') {
    return await applyWorkspaces(ctx, a.chatroomId, chunk as WorkspacesChunk);
  }
  if (phase === 'links') {
    await applyLinks(ctx, a.chatroomId, chunk as LinksChunk);
    return {};
  }
  return await applyRowChunk(ctx, a, phase, chunk as LeafChunk);
}

async function applyRowChunk(
  ctx: MutationCtx,
  a: { ownerId: Id<'users'>; chatroomId: Id<'chatroom_rooms'> },
  phase: Exclude<SupportedPhase, 'workspaces' | 'links'>,
  chunk: LeafChunk
): Promise<Record<string, string>> {
  if (phase === 'messages') return await applyMessages(ctx, a.chatroomId, a.ownerId, chunk);
  if (phase === 'tasks') return await applyTasks(ctx, a.chatroomId, a.ownerId, chunk);
  if (phase === 'messageQueue') return await applyMessageQueue(ctx, a.chatroomId, a.ownerId, chunk);
  return await applyLeafRows(ctx, a.chatroomId, a.ownerId, chunk);
}

export async function finalizeImport(
  ctx: MutationCtx,
  a: {
    ownerId: Id<'users'>;
    chatroomId: Id<'chatroom_rooms'>;
    status: 'active' | 'completed';
    lastActivityAt: number | null;
    nextQueuePosition: number;
  }
): Promise<void> {
  const room = await loadImportingRoom(ctx, a.ownerId, a.chatroomId);

  await ctx.db.patch('chatroom_rooms', a.chatroomId, {
    status: a.status,
    lastActivityAt: a.lastActivityAt ?? undefined,
    nextQueuePosition: Math.max(room.nextQueuePosition ?? 0, a.nextQueuePosition),
  });

  await upsertReadCursor(ctx, {
    chatroomId: a.chatroomId,
    userId: a.ownerId,
    now: Date.now(),
  });
  await clearChatroomUnread(ctx, a.chatroomId, a.ownerId);
}

// fallow-ignore-next-line complexity
export async function rollbackImportBatch(
  ctx: MutationCtx,
  a: { ownerId: Id<'users'>; chatroomId: Id<'chatroom_rooms'> }
): Promise<{ drained: boolean }> {
  const room = await ctx.db.get('chatroom_rooms', a.chatroomId);
  if (!room) return { drained: true };
  await loadImportingRoom(ctx, a.ownerId, a.chatroomId);

  let budget = IMPORT_ROLLBACK_BUDGET;
  for (const table of ROLLBACK_ORDER) {
    if (table === 'chatroom_rooms') continue;

    const entry = rollbackEntryOf(table);
    const limit = Math.floor(budget / entry.cost);
    if (limit === 0) return { drained: false };

    const rows = await entry.take(ctx, { chatroomId: a.chatroomId, ownerId: a.ownerId }, limit);
    for (const row of rows) {
      // The registry names tables at runtime; the generated delete overload cannot
      // be expressed for a dynamic table name (see the note in registry.ts).
      await ctx.db.delete(table as TableNames, row._id as never);
    }
    budget -= rows.length * entry.cost;
    if (rows.length === limit) return { drained: false };
  }

  await ctx.db.delete('chatroom_rooms', a.chatroomId);
  return { drained: true };
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * C1: the single guard for every write and for rollback. A room is importable
 * only while the caller owns it, it is still `completed`, and it is younger
 * than the import window.
 */
// fallow-ignore-next-line complexity
async function loadImportingRoom(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_rooms'>> {
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  if (
    !room ||
    room.ownerId !== ownerId ||
    room.status !== 'completed' ||
    Date.now() - room._creationTime > IMPORT_WINDOW_MS
  ) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.IMPORT_TARGET_NOT_IMPORTING,
      message: 'Chatroom is not an import in progress',
    });
  }
  return room;
}

// ---------------------------------------------------------------------------
// Chunk envelope
// ---------------------------------------------------------------------------

type LeafPhase =
  | 'artifacts'
  | 'backlog'
  | 'contexts'
  | 'scheduledPrompts'
  | 'savedCommands'
  | 'skillCustomizations';

interface WorkspacesChunk {
  phase: 'workspaces';
  machineId: string;
  rows: ImportRowPayload[];
  primaryKey: string | null;
  refs: Record<string, string>;
}

interface LeafChunk {
  phase: LeafPhase;
  rows: ImportRowPayload[];
  refs: Record<string, string>;
}

interface LinksChunk {
  phase: 'links';
  patches: LinkPatch[];
  refs: Record<string, string>;
}

const LEAF_PHASES: ReadonlySet<string> = new Set<LeafPhase>([
  'artifacts',
  'backlog',
  'contexts',
  'scheduledPrompts',
  'savedCommands',
  'skillCustomizations',
]);

/** Every phase this round can apply; `agentConfigs` lands with the driver in P8b. */
type SupportedPhase = 'workspaces' | 'links' | 'messages' | 'tasks' | 'messageQueue' | LeafPhase;

const SUPPORTED_PHASES: ReadonlySet<string> = new Set<string>([
  'workspaces',
  'links',
  'messages',
  'tasks',
  'messageQueue',
  ...LEAF_PHASES,
]);

function phaseOf(chunk: unknown): unknown {
  return isRecord(chunk) ? chunk.phase : undefined;
}

function isSupportedPhase(phase: unknown): phase is SupportedPhase {
  return typeof phase === 'string' && SUPPORTED_PHASES.has(phase);
}

/**
 * C5: the driver fills `refs`, so the shape is validated here rather than
 * trusted from `v.any()`. A malformed envelope is a chunk failure, never a
 * partial write.
 */
// fallow-ignore-next-line complexity
function assertChunkEnvelope(
  chunk: unknown
): asserts chunk is LeafChunk | WorkspacesChunk | LinksChunk {
  if (!isRecord(chunk)) throw chunkFailure('chunk must be an object');
  if (chunk.phase === 'links') assertLinksEnvelope(chunk);
  else assertRowsEnvelope(chunk);
  assertRefsEnvelope(chunk);
}

function assertRowsEnvelope(chunk: Record<string, unknown>): void {
  if (!Array.isArray(chunk.rows)) throw chunkFailure('chunk.rows must be an array');
  for (const row of chunk.rows) assertRowPayload(row);
  if (chunk.phase === 'workspaces') assertWorkspacesEnvelope(chunk);
}

function assertRowPayload(row: unknown): void {
  if (!isRecord(row)) throw chunkFailure('each chunk row must be an object');
  if (typeof row.key !== 'string') throw chunkFailure('each chunk row needs a string key');
  if (!isRecord(row.fields)) throw chunkFailure(`row ${row.key} needs a fields object`);
}

function assertWorkspacesEnvelope(chunk: Record<string, unknown>): void {
  if (typeof chunk.machineId !== 'string') {
    throw chunkFailure('a workspaces chunk needs a machineId');
  }
  if (typeof chunk.primaryKey !== 'string' && chunk.primaryKey !== null) {
    throw chunkFailure('a workspaces chunk needs a primaryKey or null');
  }
}

function assertLinksEnvelope(chunk: Record<string, unknown>): void {
  if (!Array.isArray(chunk.patches)) throw chunkFailure('a links chunk needs a patches array');
  for (const patch of chunk.patches) assertLinkPatch(patch);
}

function assertLinkPatch(patch: unknown): void {
  if (!isRecord(patch)) throw chunkFailure('each link patch must be an object');
  assertLinkTable(patch.table);
  if (typeof patch.key !== 'string') throw chunkFailure('each link patch needs a string key');
  assertLinkFields(patch.fields);
}

function assertLinkTable(table: unknown): void {
  if (table !== 'messages' && table !== 'tasks' && table !== 'artifacts') {
    throw chunkFailure('a link patch targets messages, tasks or artifacts');
  }
}

function assertLinkFields(fields: unknown): void {
  if (!isRecord(fields)) throw chunkFailure('each link patch needs a fields object');
  for (const value of Object.values(fields)) {
    if (!isLinkFieldValue(value)) {
      throw chunkFailure('link field values must be string keys or arrays of them');
    }
  }
}

function isLinkFieldValue(value: unknown): boolean {
  if (typeof value === 'string') return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function assertRefsEnvelope(chunk: Record<string, unknown>): void {
  if (!isRecord(chunk.refs)) throw chunkFailure('chunk.refs must be an object');
  for (const value of Object.values(chunk.refs)) {
    if (typeof value !== 'string') throw chunkFailure('chunk.refs values must be strings');
  }
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

/** Fields a workspaces row may carry; everything else is source-machine data. */
const WORKSPACE_FIELDS: ReadonlySet<string> = new Set(['workingDir', 'fileTreeSyncEnabled']);

// fallow-ignore-next-line complexity
async function applyWorkspaces(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  chunk: WorkspacesChunk
): Promise<Record<string, string>> {
  const machine = await findMachine(ctx, chunk.machineId);
  if (!machine) throw machineNotFound();

  const created: Record<string, string> = {};
  for (const row of chunk.rows) {
    assertWorkspaceFields(row);
    const id = await registerWorkspace(ctx, {
      chatroomId,
      machineId: chunk.machineId,
      workingDir: String(row.fields.workingDir),
      hostname: machine.hostname,
      registeredBy: 'user',
    });
    if (row.fields.fileTreeSyncEnabled === true) {
      await ctx.db.patch('chatroom_workspaces', id, { fileTreeSyncEnabled: true });
    }
    created[row.key] = String(id);
  }

  if (chunk.primaryKey !== null) {
    const workspaceId = created[chunk.primaryKey];
    if (workspaceId === undefined) {
      throw chunkFailure(`primary workspace key ${chunk.primaryKey} was not imported`);
    }
    await insertInitialPrimaryWorkspace(ctx, {
      chatroomId,
      workspaceId: workspaceId as Id<'chatroom_workspaces'>,
    });
  }

  return created;
}

function assertWorkspaceFields(row: ImportRowPayload): void {
  for (const field of Object.keys(row.fields)) {
    if (!WORKSPACE_FIELDS.has(field)) {
      throw chunkFailure(`field ${field} is not importable in a workspaces chunk`);
    }
  }
}

// ---------------------------------------------------------------------------
// Leaf rows
// ---------------------------------------------------------------------------

// fallow-ignore-next-line complexity
async function applyLeafRows(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  ownerId: Id<'users'>,
  chunk: LeafChunk
): Promise<Record<string, string>> {
  const { table } = exportedEntryFor(chunk.phase);
  const created: Record<string, string> = {};

  for (const row of chunk.rows) {
    const doc = await buildRowDoc(ctx, table, chatroomId, ownerId, row.fields, chunk.refs);
    const id = await insertRow(ctx, table, doc);
    created[row.key] = String(id);
  }

  return created;
}

/**
 * Builds the target row for one file row: the chatroom, the server-set fields,
 * then every writable registry field, resolving refs through `refs`.
 */
async function buildRowDoc(
  ctx: MutationCtx,
  table: string,
  chatroomId: Id<'chatroom_rooms'>,
  ownerId: Id<'users'>,
  fields: Record<string, unknown>,
  refs: Record<string, string>
): Promise<Record<string, unknown>> {
  const rules = rulesOf(table);
  const doc: Record<string, unknown> = {
    chatroomId,
    ...serverFieldsFor(table, ownerId),
  };
  for (const [field, value] of Object.entries(fields)) {
    doc[field] = await writableValue(ctx, chatroomId, refs, rules[field], field, value);
  }
  return doc;
}

/** One field through its registry rule; a field without a writable rule is refused. */
async function writableValue(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  refs: Record<string, string>,
  rule: FieldRule | undefined,
  field: string,
  value: unknown
): Promise<unknown> {
  if (!rule || !WRITABLE_RULES.has(rule.rule)) {
    throw chunkFailure(`field ${field} is not importable`);
  }
  return rule.rule === 'ref' ? await resolveRef(ctx, rule.table, chatroomId, refs, value) : value;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * A message row may carry `terminalHandoffRole` — the source key's third segment
 * — outside the registry. The key is derived from the new chatroom and the new
 * origin id, never copied from the file.
 */
async function applyMessages(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  ownerId: Id<'users'>,
  chunk: LeafChunk
): Promise<Record<string, string>> {
  const created: Record<string, string> = {};

  for (const row of chunk.rows) {
    const { [HANDOFF_ROLE_FIELD]: role, ...fields } = row.fields;
    const doc = await buildRowDoc(
      ctx,
      'chatroom_messages',
      chatroomId,
      ownerId,
      fields,
      chunk.refs
    );
    addHandoffKey(chatroomId, doc, role);
    const id = await insertChatroomMessage(ctx, doc as never);
    created[row.key] = String(id);
  }

  return created;
}

/**
 * Derives the key from the new chatroom and the row's resolved origin. The
 * planner keeps the role on the row only when the origin is immediate.
 */
function addHandoffKey(
  chatroomId: Id<'chatroom_rooms'>,
  doc: Record<string, unknown>,
  role: unknown
): void {
  if (role === undefined) return;
  if (typeof role !== 'string' || typeof doc.taskOriginMessageId !== 'string') {
    throw chunkFailure('terminalHandoffRole needs a resolved taskOriginMessageId');
  }
  doc.terminalHandoffKey = terminalHandoffKeyOf(chatroomId, doc.taskOriginMessageId, role);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Tasks write three derived states: the active header projection, the status
 * signal, and the materialized counters. They are written once per row so the
 * counts after a chunk equal the rows the chunk added.
 */
async function applyTasks(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  ownerId: Id<'users'>,
  chunk: LeafChunk
): Promise<Record<string, string>> {
  const created: Record<string, string> = {};
  const counts: Partial<Record<TaskCountField, number>> = {};

  for (const row of chunk.rows) {
    const doc = await buildRowDoc(
      ctx,
      'chatroom_tasks',
      chatroomId,
      ownerId,
      row.fields,
      chunk.refs
    );
    const id = await insertRow(ctx, 'chatroom_tasks', doc);
    await projectImportedTask(ctx, id as Id<'chatroom_tasks'>, counts);
    created[row.key] = String(id);
  }

  await applyTaskCounts(ctx, chatroomId, counts);
  return created;
}

/** Writes the two projections and records the task's status counter. */
async function projectImportedTask(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>,
  counts: Partial<Record<TaskCountField, number>>
): Promise<void> {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) throw chunkFailure(`task ${taskId} was not written`);

  await syncActiveTaskHeader(ctx, task);
  await writeTaskStatusSignals(ctx, task);
  const field = statusToCountField(task.status);
  if (field) counts[field] = (counts[field] ?? 0) + 1;
}

/** One increment per field, after the chunk, so counts equal the rows added. */
async function applyTaskCounts(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  counts: Partial<Record<TaskCountField, number>>
): Promise<void> {
  for (const [field, count] of Object.entries(counts)) {
    await adjustTaskCount(ctx, chatroomId, field as TaskCountField, count);
  }
}

// ---------------------------------------------------------------------------
// Message queue
// ---------------------------------------------------------------------------

async function applyMessageQueue(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  ownerId: Id<'users'>,
  chunk: LeafChunk
): Promise<Record<string, string>> {
  const created: Record<string, string> = {};

  for (const row of chunk.rows) {
    const doc = await buildRowDoc(
      ctx,
      'chatroom_messageQueue',
      chatroomId,
      ownerId,
      row.fields,
      chunk.refs
    );
    const id = await insertRow(ctx, 'chatroom_messageQueue', doc);
    created[row.key] = String(id);
  }

  if (chunk.rows.length > 0) {
    await adjustTaskCount(ctx, chatroomId, 'queueSize', chunk.rows.length);
  }

  return created;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

async function applyLinks(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  chunk: LinksChunk
): Promise<void> {
  for (const patch of chunk.patches) {
    await applyLinkPatch(ctx, chatroomId, chunk.refs, patch);
  }
}

/**
 * Patches one row's deferred ref fields. The patch's own key goes through
 * `resolveRefKey` so a row in another chatroom is refused, and a field without
 * a `ref` rule is refused because only links are deferred.
 */
async function applyLinkPatch(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  refs: Record<string, string>,
  patch: LinkPatch
): Promise<void> {
  const { table } = exportedEntryFor(patch.table);
  const id = await resolveLinkRow(ctx, table, chatroomId, refs, patch.key);
  const fields = await linkFieldsOf(ctx, table, chatroomId, refs, patch.fields);

  if (Object.keys(fields).length > 0) {
    await ctx.db.patch(table as TableNames, id as never, fields as never);
  }
  if (table === 'chatroom_messages') await applyMessageLink(ctx, chatroomId, id, patch.fields);
  if (table === 'chatroom_tasks') await refreshTaskHeader(ctx, id);
}

/** The patch's own row; a missing or cross-chatroom row is a chunk failure. */
async function resolveLinkRow(
  ctx: MutationCtx,
  table: string,
  chatroomId: Id<'chatroom_rooms'>,
  refs: Record<string, string>,
  key: string
): Promise<string> {
  const resolved = await resolveRefKey(ctx, table, chatroomId, refs, key);
  if (typeof resolved !== 'string') throw chunkFailure(`unresolved reference ${key}`);
  return resolved;
}

/** Resolves every ref field of a patch, leaving the handoff role to its own step. */
async function linkFieldsOf(
  ctx: MutationCtx,
  table: string,
  chatroomId: Id<'chatroom_rooms'>,
  refs: Record<string, string>,
  values: Record<string, string | string[]>
): Promise<Record<string, unknown>> {
  const rules = rulesOf(table);
  const fields: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(values)) {
    if (isHandoffRoleField(table, field)) continue; // handled by applyMessageLink
    fields[field] = await linkFieldValue(ctx, rules[field], field, chatroomId, refs, value);
  }

  return fields;
}

async function linkFieldValue(
  ctx: MutationCtx,
  rule: FieldRule | undefined,
  field: string,
  chatroomId: Id<'chatroom_rooms'>,
  refs: Record<string, string>,
  value: string | string[]
): Promise<unknown> {
  if (rule?.rule !== 'ref') throw chunkFailure(`field ${field} is not a link field`);
  return await resolveRef(ctx, rule.table, chatroomId, refs, value);
}

/** The handoff role rides in a message's link patch but is not a ref field. */
function isHandoffRoleField(table: string, field: string): boolean {
  return table === 'chatroom_messages' && field === HANDOFF_ROLE_FIELD;
}

/** Derives the handoff key after the origin link landed, then syncs the read model. */
async function applyMessageLink(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  messageId: string,
  values: Record<string, string | string[]>
): Promise<void> {
  const role = values[HANDOFF_ROLE_FIELD];
  if (role !== undefined) await deriveMessageHandoffKey(ctx, chatroomId, messageId, role);
  await syncMessageReadModel(ctx, messageId as Id<'chatroom_messages'>);
}

async function deriveMessageHandoffKey(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  messageId: string,
  role: unknown
): Promise<void> {
  const message = await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
  if (typeof role !== 'string' || !message?.taskOriginMessageId) {
    throw chunkFailure('terminalHandoffRole needs a linked taskOriginMessageId');
  }
  await ctx.db.patch('chatroom_messages', message._id, {
    terminalHandoffKey: terminalHandoffKeyOf(chatroomId, message.taskOriginMessageId, role),
  });
}

async function refreshTaskHeader(ctx: MutationCtx, taskId: string): Promise<void> {
  const task = await ctx.db.get('chatroom_tasks', taskId as Id<'chatroom_tasks'>);
  if (task) await syncActiveTaskHeader(ctx, task);
}

/** Only copy/reset/ref rules are written by an import. */
const WRITABLE_RULES: ReadonlySet<string> = new Set(['copy', 'reset', 'ref']);

/** Server-set fields the registry does not carry, keyed by table. */
function serverFieldsFor(table: string, ownerId: Id<'users'>): Record<string, unknown> {
  if (table === 'chatroom_scheduledPrompts') return { createdBy: ownerId };
  if (table === 'chatroom_skillCustomizations') return { ownerId };
  return {};
}

/** Inserts a row into a table named at runtime. The single cast is the table name. */
async function insertRow(
  ctx: MutationCtx,
  table: string,
  doc: Record<string, unknown>
): Promise<Id<TableNames>> {
  // The registry names tables at runtime; the generated insert overload cannot be
  // expressed for a dynamic table name (see the note in registry.ts).
  return (await ctx.db.insert(table as TableNames, doc as never)) as Id<TableNames>;
}

/**
 * C5: resolves a ref key from `chunk.refs`. The target must exist and belong to
 * the same chatroom; a missing key, a missing row or a cross-chatroom row is a
 * chunk failure. Array values resolve element by element.
 */
async function resolveRef(
  ctx: MutationCtx,
  table: string,
  chatroomId: Id<'chatroom_rooms'>,
  refs: Record<string, string>,
  value: unknown
): Promise<unknown> {
  if (Array.isArray(value)) {
    const ids: unknown[] = [];
    for (const entry of value) ids.push(await resolveRefKey(ctx, table, chatroomId, refs, entry));
    return ids;
  }
  return await resolveRefKey(ctx, table, chatroomId, refs, value);
}

// fallow-ignore-next-line complexity
async function resolveRefKey(
  ctx: MutationCtx,
  table: string,
  chatroomId: Id<'chatroom_rooms'>,
  refs: Record<string, string>,
  key: unknown
): Promise<unknown> {
  if (typeof key !== 'string') throw chunkFailure('a ref value must be a string key');
  const id = refs[key];
  if (id === undefined) throw chunkFailure(`unresolved reference ${key}`);

  let target: Record<string, unknown> | null;
  try {
    target = (await ctx.db.get(table as TableNames, id as never)) as Record<string, unknown> | null;
  } catch {
    throw chunkFailure(`unresolved reference ${key}`);
  }
  if (!target) throw chunkFailure(`unresolved reference ${key}`);
  if (target.chatroomId !== chatroomId) {
    throw chunkFailure(`reference ${key} points at another chatroom`);
  }
  return target._id;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function standingInstructionFields(
  header: ImportHeader
): Pick<
  Partial<Doc<'chatroom_rooms'>>,
  'standingInstructions' | 'standingInstructionsEnabled' | 'standingInstructionsTitle'
> {
  const fields: Pick<
    Partial<Doc<'chatroom_rooms'>>,
    'standingInstructions' | 'standingInstructionsEnabled' | 'standingInstructionsTitle'
  > = {};
  if (header.standingInstructions !== undefined) {
    fields.standingInstructions = header.standingInstructions;
  }
  if (header.standingInstructionsEnabled !== undefined) {
    fields.standingInstructionsEnabled = header.standingInstructionsEnabled;
  }
  if (header.standingInstructionsTitle !== undefined) {
    fields.standingInstructionsTitle = header.standingInstructionsTitle;
  }
  return fields;
}

async function findMachine(ctx: MutationCtx, machineId: string) {
  return await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
}

function machineNotFound(): ConvexError<{ code: string; message: string }> {
  return new ConvexError({
    code: BACKEND_ERROR_CODES.IMPORT_MACHINE_NOT_FOUND,
    message: 'Machine not found',
  });
}

function rollbackEntryOf(table: string): RollbackDescriptor {
  const entry = CHATROOM_SCOPED_TABLES[table];
  if (!entry?.rollback) {
    throw new Error(`Chatroom transfer registry: no rollback descriptor for ${table}`);
  }
  return entry.rollback;
}

function chunkFailure(message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: BACKEND_ERROR_CODES.IMPORT_CHUNK_FAILED, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
