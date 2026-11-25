/**
 * Chatroom import — driver.
 *
 * Orchestrates one import over `ChatroomImportPort`:
 *
 * 1. Validate the file (no port call yet). A refusal throws `ChatroomTransferError`.
 * 2. Preflight the target machine, then build the plan. A refusal throws, with no write.
 * 3. Dry run returns the plan and makes zero write calls.
 * 4. Otherwise begin, then apply each chunk once, in order, then finalize.
 *    Success is returned only after finalize resolves. A chunk is never retried.
 * 5. Any error, or an aborted signal, runs rollback until it drains.
 *
 * No file I/O and no Convex imports. The CLI and convex-test adapt the port.
 */
import type { ImportChunk, ImportHeader } from './import-apply';
import {
  buildImportPlan,
  validateExportFile,
  type ImportPlan,
  type ImportTarget,
} from './import-plan';
import { ChatroomTransferError, TRANSFER_ERROR_CODES } from '../../entities/chatroom-transfer-file';

/** A rollback that has not drained after this many batches is reported as failed. */
const ROLLBACK_MAX_ITERATIONS = 200;

export interface ChatroomImportPort {
  preflight(a: {
    machineId: string;
    teamStructureId: string;
    workingDirs: string[];
  }): Promise<ImportTarget & { hostname: string }>;
  begin(a: { header: ImportHeader; machineId: string }): Promise<{ chatroomId: string }>;
  applyChunk(a: {
    chatroomId: string;
    chunk: ImportChunk;
  }): Promise<{ created: Record<string, string> }>;
  finalize(a: {
    chatroomId: string;
    status: 'active' | 'completed';
    lastActivityAt: number | null;
    nextQueuePosition: number;
  }): Promise<void>;
  rollback(a: { chatroomId: string }): Promise<{ drained: boolean }>;
}

export type ImportOutcome =
  | { status: 'dry-run'; plan: ImportPlan }
  | { status: 'imported'; chatroomId: string; plan: ImportPlan }
  | { status: 'rolled-back'; cause: Error }
  | { status: 'rollback-failed'; orphanChatroomId: string; cause: Error; rollbackError: Error };

export interface RunImportArgs {
  json: string;
  machineId: string;
  dryRun: boolean;
  /** Called once, right after `begin`, so a caller can print the id before any chunk lands. */
  onStarted?: (chatroomId: string) => void;
  /** Checked before each chunk and before finalize. An abort rolls the import back. */
  signal?: AbortSignal;
}

export async function runImport(
  port: ChatroomImportPort,
  args: RunImportArgs
): Promise<ImportOutcome> {
  const validation = await validateExportFile(args.json);
  if (!validation.ok) {
    throw new ChatroomTransferError(validation.code, validation.message, validation.details);
  }
  const file = validation.file;
  const preflight = await port.preflight({
    machineId: args.machineId,
    teamStructureId: String(file.room.teamStructureId),
    workingDirs: file.workspaces.map((row) => String(row.workingDir)),
  });
  const planned = buildImportPlan(file, preflight);
  if (!planned.ok) {
    throw new ChatroomTransferError(planned.code, planned.message, planned.details);
  }
  if (args.dryRun) return { status: 'dry-run', plan: planned.plan };
  return await writePlan(port, planned.plan, args);
}

/**
 * The write phase. `begin` runs before the `try`: nothing has been written yet,
 * so a refused begin propagates instead of rolling back a room that never existed.
 */
async function writePlan(
  port: ChatroomImportPort,
  plan: ImportPlan,
  args: RunImportArgs
): Promise<ImportOutcome> {
  const { chatroomId } = await port.begin({ header: plan.header, machineId: args.machineId });
  args.onStarted?.(chatroomId);

  try {
    await applyChunks(port, plan, chatroomId, args.signal);
    throwIfAborted(args.signal);
    await port.finalize({ chatroomId, ...plan.finalize });
    return { status: 'imported', chatroomId, plan };
  } catch (cause) {
    return await rollbackAfter(port, chatroomId, toError(cause));
  }
}

/** Applies each chunk once, in order, carrying the keys every earlier chunk created. */
async function applyChunks(
  port: ChatroomImportPort,
  plan: ImportPlan,
  chatroomId: string,
  signal: AbortSignal | undefined
): Promise<void> {
  const created = new Map<string, string>();
  for (const chunk of plan.chunks) {
    throwIfAborted(signal);
    const result = await port.applyChunk({
      chatroomId,
      chunk: { ...chunk, refs: refsFor(chunk, created) } as ImportChunk,
    });
    assertCreatedCount(chunk, result.created);
    for (const [key, id] of Object.entries(result.created)) created.set(key, id);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('import aborted');
}

/**
 * The refs a chunk needs: every file key its rows and patches mention, filtered
 * to keys an earlier chunk created. Over-inclusion is harmless. A key that is
 * missing is left out, so the apply fails loudly instead of resolving to nothing.
 */
function refsFor(chunk: ImportChunk, created: Map<string, string>): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const key of keysReferencedBy(chunk)) {
    const id = created.get(key);
    if (id !== undefined) refs[key] = id;
  }
  return refs;
}

function keysReferencedBy(chunk: ImportChunk): string[] {
  if (chunk.phase === 'links') {
    return chunk.patches.flatMap((patch) => [patch.key, ...valueKeys(patch.fields)]);
  }
  if (chunk.phase === 'workspaces') {
    return chunk.primaryKey === null ? [] : [chunk.primaryKey];
  }
  return chunk.rows.flatMap((row) => valueKeys(row.fields));
}

/** Every string value, and every string element of an array value. */
function valueKeys(fields: Record<string, unknown>): string[] {
  return Object.values(fields).flatMap(keysOfValue);
}

function keysOfValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter(isString);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * A chunk must create exactly its rows, except `links`, which patches rows and
 * creates none. The plan's chunk shape is the contract the apply relies on.
 */
function assertCreatedCount(chunk: ImportChunk, created: Record<string, string>): void {
  const expected = chunk.phase === 'links' ? 0 : chunk.rows.length;
  if (Object.keys(created).length !== expected) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_CHUNK_FAILED,
      'chunk created an unexpected row count'
    );
  }
}

/** Drains rollback in budgeted batches; a failure is reported, never swallowed. */
async function rollbackAfter(
  port: ChatroomImportPort,
  chatroomId: string,
  cause: Error
): Promise<ImportOutcome> {
  try {
    for (let attempt = 0; attempt < ROLLBACK_MAX_ITERATIONS; attempt += 1) {
      const { drained } = await port.rollback({ chatroomId });
      if (drained) return { status: 'rolled-back', cause };
    }
    return {
      status: 'rollback-failed',
      orphanChatroomId: chatroomId,
      cause,
      rollbackError: new Error('rollback did not drain'),
    };
  } catch (rollbackError) {
    return {
      status: 'rollback-failed',
      orphanChatroomId: chatroomId,
      cause,
      rollbackError: toError(rollbackError),
    };
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
