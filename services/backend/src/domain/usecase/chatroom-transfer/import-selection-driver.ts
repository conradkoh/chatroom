/**
 * Chatroom import — selection driver.
 *
 * Runs one independent import per selected chatroom, strictly in selection
 * order. `runImport` remains the per-chatroom engine; this module only decides
 * what happens to the entries that were not started:
 *
 * - a failed entry never rolls back an earlier imported entry (each `begin` is
 *   its own chatroom);
 * - a target-wide refusal (`IMPORT_MACHINE_NOT_FOUND`, `IMPORT_MACHINE_NOT_OWNED`,
 *   auth) marks every remaining entry `skipped: 'fatal'` and stops calling the
 *   port;
 * - an abort marks the entry that was in progress through `runImport`'s own
 *   rollback path, then every remaining entry `skipped: 'cancelled'`.
 *
 * The function returns results for entry-level and fatal conditions instead of
 * throwing, because the CLI must still print the summary and every finished
 * chatroom. Only a programming error escapes.
 */

import { importValidatedFile, type ChatroomImportPort, type ImportOutcome } from './import-driver';
import type { TransferListing } from './import-listing';
import type { ImportPlan } from './import-plan';
import { ChatroomTransferError, TRANSFER_ERROR_CODES } from '../../entities/chatroom-transfer-file';

export type EntryImportResult =
  | { key: string; status: 'imported'; chatroomId: string; plan: ImportPlan }
  | { key: string; status: 'dry-run'; plan: ImportPlan }
  | {
      key: string;
      status: 'failed';
      code: string;
      message: string;
      details: string[];
      rolledBack: boolean;
      orphanChatroomId?: string;
    }
  | { key: string; status: 'skipped'; reason: 'cancelled' | 'fatal' };

export type ImportRunEvent =
  | { type: 'entry-started'; key: string; index: number; total: number }
  | { type: 'chatroom-created'; key: string; chatroomId: string }
  | { type: 'chunk-applied'; key: string; done: number; total: number }
  | { type: 'entry-finished'; key: string; result: EntryImportResult };

export interface SelectedImportArgs {
  listing: TransferListing;
  keys: readonly string[];
  machineId: string;
  dryRun: boolean;
  signal?: AbortSignal;
  onEvent?: (event: ImportRunEvent) => void;
}

export interface SelectedImportSummary {
  results: EntryImportResult[];
  /** `status === 'imported'` only. */
  imported: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  fatal: { code: string; message: string } | null;
}

/** A refusal from the target itself, not from the file; no later entry can succeed. */
const TARGET_WIDE_CODES: ReadonlySet<string> = new Set([
  'IMPORT_MACHINE_NOT_FOUND',
  'IMPORT_MACHINE_NOT_OWNED',
  'AUTH_FAILED',
  'NOT_AUTHENTICATED',
]);

interface RunState {
  results: EntryImportResult[];
  fatal: SelectedImportSummary['fatal'];
  cancelled: boolean;
}

export async function runSelectedImports(
  port: ChatroomImportPort,
  args: SelectedImportArgs
): Promise<SelectedImportSummary> {
  const state: RunState = { results: [], fatal: null, cancelled: false };

  for (const [index, key] of args.keys.entries()) {
    if (state.fatal !== null) {
      state.results.push(record(skipped(key, 'fatal'), args));
      continue;
    }
    if (isAborted(args.signal)) {
      cancelRemaining(state, args, index);
      break;
    }
    await runOne(port, args, key, index, state);
  }

  return summarize(state.results, state.cancelled, state.fatal);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** Runs one entry, records it, and promotes a target-wide refusal to `fatal`. */
async function runOne(
  port: ChatroomImportPort,
  args: SelectedImportArgs,
  key: string,
  index: number,
  state: RunState
): Promise<void> {
  const result = await runEntry(port, args, key, index);
  state.results.push(record(result, args));
  if (isTargetWide(result)) state.fatal = { code: result.code, message: result.message };
}

function isTargetWide(
  result: EntryImportResult
): result is Extract<EntryImportResult, { status: 'failed' }> {
  return result.status === 'failed' && TARGET_WIDE_CODES.has(result.code);
}

function cancelRemaining(state: RunState, args: SelectedImportArgs, from: number): void {
  state.cancelled = true;
  state.results.push(...recordRemaining(args, from));
}

/** Runs one entry and maps every outcome to a result; never throws for a port refusal. */
async function runEntry(
  port: ChatroomImportPort,
  args: SelectedImportArgs,
  key: string,
  index: number
): Promise<EntryImportResult> {
  const file = args.listing.files.get(key);
  if (file === undefined) return failedFromValidity(args.listing, key);

  emit(args, { type: 'entry-started', key, index: index + 1, total: args.keys.length });
  try {
    const outcome = await importValidatedFile(port, file, writeArgsFor(args, key));
    return mapOutcome(key, outcome);
  } catch (error) {
    return thrownFailure(key, error);
  }
}

function writeArgsFor(args: SelectedImportArgs, key: string) {
  return {
    machineId: args.machineId,
    dryRun: args.dryRun,
    onStarted: (chatroomId: string) => emit(args, { type: 'chatroom-created', key, chatroomId }),
    onChunk: (done: number, total: number) =>
      emit(args, { type: 'chunk-applied', key, done, total }),
    ...(args.signal === undefined ? {} : { signal: args.signal }),
  };
}

function thrownFailure(key: string, error: unknown): EntryImportResult {
  return {
    key,
    status: 'failed',
    code: codeOf(error),
    message: messageOf(error),
    details: error instanceof ChatroomTransferError ? error.details : [],
    rolledBack: false,
  };
}

/** An entry that was listed as `not importable` never reaches the port. */
function failedFromValidity(listing: TransferListing, key: string): EntryImportResult {
  const entry = listing.entries.find((candidate) => candidate.key === key);
  if (entry !== undefined && !entry.validity.ok) {
    return {
      key,
      status: 'failed',
      code: entry.validity.code,
      message: entry.validity.message,
      details: [],
      rolledBack: false,
    };
  }
  return {
    key,
    status: 'failed',
    code: TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
    message: 'The file is not a readable chatroom export.',
    details: [],
    rolledBack: false,
  };
}

function mapOutcome(key: string, outcome: ImportOutcome): EntryImportResult {
  if (outcome.status === 'dry-run') return { key, status: 'dry-run', plan: outcome.plan };
  if (outcome.status === 'imported') {
    return { key, status: 'imported', chatroomId: outcome.chatroomId, plan: outcome.plan };
  }
  if (outcome.status === 'rolled-back') {
    return {
      key,
      status: 'failed',
      code: TRANSFER_ERROR_CODES.IMPORT_ROLLED_BACK,
      message: `The import did not complete and was rolled back. No rows were kept. Cause: ${outcome.cause.message}`,
      details: [],
      rolledBack: true,
    };
  }
  return {
    key,
    status: 'failed',
    code: TRANSFER_ERROR_CODES.IMPORT_ROLLBACK_FAILED,
    message: `Rollback did not finish. Chatroom ${outcome.orphanChatroomId} may still exist and may be active.`,
    details: [],
    rolledBack: false,
    orphanChatroomId: outcome.orphanChatroomId,
  };
}

/** Records every remaining key as cancelled, in order, and reports each one. */
function recordRemaining(args: SelectedImportArgs, from: number): EntryImportResult[] {
  return args.keys.slice(from).map((key) => record(skipped(key, 'cancelled'), args));
}

function skipped(key: string, reason: 'cancelled' | 'fatal'): EntryImportResult {
  return { key, status: 'skipped', reason };
}

function record(result: EntryImportResult, args: SelectedImportArgs): EntryImportResult {
  emit(args, { type: 'entry-finished', key: result.key, result });
  return result;
}

function emit(args: SelectedImportArgs, event: ImportRunEvent): void {
  args.onEvent?.(event);
}

function summarize(
  results: EntryImportResult[],
  cancelled: boolean,
  fatal: SelectedImportSummary['fatal']
): SelectedImportSummary {
  return {
    results,
    imported: results.filter((result) => result.status === 'imported').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    cancelled,
    fatal,
  };
}

/**
 * The refusal code of a thrown error: the transfer error's own code, a plain
 * `code`, or a Convex error's `data.code`. Anything else is `UNKNOWN`, so a
 * message is still reported instead of the run aborting.
 */
function codeOf(error: unknown): string {
  if (error instanceof ChatroomTransferError) return error.code;
  return stringField(error, 'code') ?? stringField(readField(error, 'data'), 'code') ?? 'UNKNOWN';
}

function stringField(value: unknown, field: string): string | undefined {
  const raw = readField(value, field);
  return typeof raw === 'string' ? raw : undefined;
}

function readField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[field];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
