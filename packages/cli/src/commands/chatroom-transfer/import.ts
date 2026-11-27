/**
 * `chatroom import` — list an export file offline, choose chatrooms, import each.
 *
 * The file is read and validated before any login, Convex call or machine
 * lookup: listing a bundle needs none of them (D5). Once keys are chosen, each
 * selected chatroom is imported independently by `runSelectedImports`, which
 * keeps `runImport` as the per-chatroom engine.
 *
 * Output keeps today's single-file shape (`Imported as new chatroom <id>`, the
 * plan lines, `no agents were started`). A bundle adds the selection listing,
 * one block per entry, and one summary line:
 * `Imported X of Y selected; Failed: Z`.
 */

import { resolve } from 'node:path';

import {
  ChatroomTransferError,
  TRANSFER_ERROR_CODES,
  type TransferErrorCode,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import type { ChatroomImportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-driver';
import {
  checkTransferFileSize,
  parseTransferFile,
  selectEntries,
  type TransferListing,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-listing';
import type { ImportPlan } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-plan';
import {
  runSelectedImports,
  type EntryImportResult,
  type ImportRunEvent,
  type SelectedImportSummary,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-selection-driver';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { ChatroomTransferDeps } from './deps.js';
import { formatListing, parseSelectTokens } from './import-listing-format.js';
import { requireTransferSession } from './session-guard.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import type { BackendOps } from '../../infrastructure/deps/index.js';

export interface ImportOptions {
  path: string;
  machineId?: string | undefined;
  dryRun?: boolean | undefined;
  select?: string | undefined;
  list?: boolean | undefined;
}

/** Builds the port the driver calls. Tests substitute this seam; production uses `convexImportPort`. */
export type MakeImportPort = (backend: BackendOps, sessionId: SessionId) => ChatroomImportPort;

/** The auth hook the command wrapper supplies; a listing never calls it. */
export interface ImportRuntime {
  makePort?: MakeImportPort;
  ensureAuth?: () => Promise<void>;
}

/** The production adapter: each port method is exactly one Convex call. */
function convexImportPort(backend: BackendOps, sessionId: SessionId): ChatroomImportPort {
  return {
    preflight: (a) => backend.query(api.chatroomImport.preflight, { sessionId, ...a }),
    begin: (a) =>
      backend.mutation(api.chatroomImport.begin, {
        sessionId,
        header: a.header,
        machineId: a.machineId,
      }),
    applyChunk: (a) =>
      backend.mutation(api.chatroomImport.applyChunk, {
        sessionId,
        chatroomId: a.chatroomId as Id<'chatroom_rooms'>,
        chunk: a.chunk,
      }),
    finalize: async (a) => {
      await backend.mutation(api.chatroomImport.finalize, {
        sessionId,
        chatroomId: a.chatroomId as Id<'chatroom_rooms'>,
        status: a.status,
        lastActivityAt: a.lastActivityAt,
        nextQueuePosition: a.nextQueuePosition,
      });
    },
    rollback: (a) =>
      backend.mutation(api.chatroomImport.rollback, {
        sessionId,
        chatroomId: a.chatroomId as Id<'chatroom_rooms'>,
      }),
  };
}

/**
 * Lists `opts.path`, then imports the chosen chatrooms as new chatrooms owned
 * by the caller. A refusal or a failed write is thrown or reported, never
 * swallowed.
 */
export async function importChatroom(
  opts: ImportOptions,
  deps: ChatroomTransferDeps,
  runtime: ImportRuntime = {}
): Promise<void> {
  const listing = await readAndList(opts, deps);
  if (listing === null) return;

  const plan = await planImport(opts, listing, deps, runtime);
  if (plan === null) return;

  const summary = await runPlan(plan, opts, deps, runtime);
  reportSummary(summary, opts, listing, plan.keys.length, deps);
  if (isRunFailure(summary)) throw summaryFailure(summary, listing, plan.keys.length);
}

/** Reads and prints the listing; `null` means `--list` asked to stop. */
async function readAndList(
  opts: ImportOptions,
  deps: ChatroomTransferDeps
): Promise<TransferListing | null> {
  const listing = await readListing(deps, opts.path);
  if (listing.kind === 'bundle' || opts.list === true) printListing(deps, listing);
  return opts.list === true ? null : listing;
}

interface ImportPlanContext {
  listing: TransferListing;
  keys: string[];
  sessionId: SessionId;
  machineId: string;
}

/**
 * Selection and the first side effects, in that order: auth and the machine id
 * are read only after the keys are known. `null` means the user chose nothing.
 */
async function planImport(
  opts: ImportOptions,
  listing: TransferListing,
  deps: ChatroomTransferDeps,
  runtime: ImportRuntime
): Promise<ImportPlanContext | null> {
  const keys = await chooseKeys(opts, listing, deps);
  if (keys === null) return null;

  await runtime.ensureAuth?.();
  const sessionId = await requireTransferSession(deps);
  if (sessionId === null) return null;
  return { listing, keys, sessionId, machineId: await resolveMachineId(opts, deps) };
}

/** One abort controller for the whole run; one resolved port for every entry. */
async function runPlan(
  plan: ImportPlanContext,
  opts: ImportOptions,
  deps: ChatroomTransferDeps,
  runtime: ImportRuntime
): Promise<SelectedImportSummary> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  deps.signals.on('SIGINT', abort);
  deps.signals.on('SIGTERM', abort);
  try {
    return await runSelectedImports(
      (runtime.makePort ?? convexImportPort)(deps.backend, plan.sessionId),
      {
        listing: plan.listing,
        keys: plan.keys,
        machineId: plan.machineId,
        dryRun: opts.dryRun === true,
        signal: controller.signal,
        onEvent: (event) => reportEvent(event, deps, plan.listing, plan.machineId),
      }
    );
  } finally {
    deps.signals.off('SIGINT', abort);
    deps.signals.off('SIGTERM', abort);
  }
}

function isRunFailure(summary: SelectedImportSummary): boolean {
  return summary.failed > 0 || summary.cancelled || summary.fatal !== null;
}

// ---------------------------------------------------------------------------
// Read and list
// ---------------------------------------------------------------------------

/**
 * Reads the file and parses it. A directory, a missing path or an unreadable
 * file is `IMPORT_FILE_UNREADABLE`; a file over the maximum is
 * `IMPORT_FILE_TOO_LARGE` and is never read.
 */
async function readListing(deps: ChatroomTransferDeps, path: string): Promise<TransferListing> {
  const full = resolve(deps.cwd(), path);
  const stats = await deps.fs.stat(full).catch((error: unknown) => {
    throw unreadable(full, reasonOf(error));
  });
  if (!stats.isFile) throw unreadable(full);

  const tooLarge = checkTransferFileSize(stats.size);
  if (tooLarge !== null) {
    throw new ChatroomTransferError(tooLarge.code, tooLarge.message, tooLarge.details);
  }

  const text = await deps.fs.readFile(full).catch((error: unknown) => {
    throw unreadable(full, reasonOf(error));
  });
  const parsed = await parseTransferFile(text);
  if (!parsed.ok) throw new ChatroomTransferError(parsed.code, parsed.message, parsed.details);
  return parsed.listing;
}

function printListing(deps: ChatroomTransferDeps, listing: TransferListing): void {
  for (const line of formatListing(listing)) deps.out(line);
}

function unreadable(path: string, reason?: string): ChatroomTransferError {
  const suffix = reason === undefined ? '' : ` (${reason})`;
  return new ChatroomTransferError(
    TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
    `not a file: ${path}${suffix}`
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Returns the chosen keys, or `null` when the user chose nothing. */
async function chooseKeys(
  opts: ImportOptions,
  listing: TransferListing,
  deps: ChatroomTransferDeps
): Promise<string[] | null> {
  if (listing.kind === 'single') return [singleKey(listing)];

  const tokens =
    opts.select === undefined ? await askForSelection(deps) : parseSelectTokens(opts.select);
  if (tokens === null) return null;
  return await resolveSelection(listing, tokens, deps);
}

/** A bundle needs `--select` or a terminal; with neither, refuse instead of guessing. */
async function askForSelection(
  deps: ChatroomTransferDeps
): Promise<readonly string[] | 'all' | null> {
  if (!deps.prompt.isInteractive()) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_SELECTION_REQUIRED,
      'No terminal to ask on. Pass --select all or --select <numbers or ids> to choose chatrooms.'
    );
  }
  const answer = await deps.prompt.ask(
    'Import which chatrooms? (all, or numbers/ids comma-separated; empty = none): '
  );
  if (answer.trim() !== '') return parseSelectTokens(answer);
  deps.out('Nothing selected; nothing was imported.');
  return null;
}

function singleKey(listing: TransferListing): string {
  const key = listing.entries[0]?.key;
  if (key === undefined) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
      'The file is not a readable chatroom export.'
    );
  }
  return key;
}

async function resolveSelection(
  listing: TransferListing,
  tokens: readonly string[] | 'all',
  deps: ChatroomTransferDeps
): Promise<string[] | null> {
  const selected = selectEntries(listing, tokens);
  if (!selected.ok) {
    throw new ChatroomTransferError(selected.code, selected.message, selected.details);
  }
  if (selected.keys.length > 0) return selected.keys;

  if (tokens === 'all') {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_SELECTION_INVALID,
      'none of the chatrooms in this file can be imported'
    );
  }
  deps.out('Nothing selected; nothing was imported.');
  return null;
}

async function resolveMachineId(opts: ImportOptions, deps: ChatroomTransferDeps): Promise<string> {
  const machineId = opts.machineId ?? (await deps.machine.getMachineId());
  if (!machineId) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_NO_MACHINE_IDENTITY,
      'This machine has no identity. Run `chatroom machine daemon start` or pass --machine-id.'
    );
  }
  return machineId;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function reportEvent(
  event: ImportRunEvent,
  deps: ChatroomTransferDeps,
  listing: TransferListing,
  machineId: string
): void {
  if (event.type === 'entry-started') return reportStarted(event, deps, listing);
  if (event.type === 'chatroom-created') return reportCreated(event.chatroomId, deps);
  if (event.type === 'entry-finished') reportResult(event.result, deps, machineId);
}

function reportStarted(
  event: Extract<ImportRunEvent, { type: 'entry-started' }>,
  deps: ChatroomTransferDeps,
  listing: TransferListing
): void {
  if (listing.kind !== 'bundle') return;
  deps.out(`Importing ${event.index} of ${event.total}: ${entryLabel(listing, event.key)}`);
}

function reportCreated(chatroomId: string, deps: ChatroomTransferDeps): void {
  deps.out(`import started: chatroom ${chatroomId} (shows as completed until the import finishes)`);
}

function entryLabel(listing: TransferListing, key: string): string {
  const entry = listing.entries.find((candidate) => candidate.key === key);
  return entry?.name ?? key;
}

function reportResult(
  result: EntryImportResult,
  deps: ChatroomTransferDeps,
  machineId: string
): void {
  if (result.status === 'dry-run') return printPlan(deps, result.plan, machineId);
  if (result.status === 'imported') return reportImported(result, deps, machineId);
  if (result.status === 'failed') return reportFailed(result, deps);
  deps.out(`Not started (${result.reason}): ${result.key}`);
}

function reportImported(
  result: Extract<EntryImportResult, { status: 'imported' }>,
  deps: ChatroomTransferDeps,
  machineId: string
): void {
  deps.out(`Imported as new chatroom ${result.chatroomId}`);
  printPlan(deps, result.plan, machineId);
}

function reportFailed(
  result: Extract<EntryImportResult, { status: 'failed' }>,
  deps: ChatroomTransferDeps
): void {
  deps.err(`❌ [${result.code}] ${result.key}: ${result.message}`);
  for (const detail of result.details) deps.err(detail);
}

function reportSummary(
  summary: SelectedImportSummary,
  opts: ImportOptions,
  listing: TransferListing,
  selected: number,
  deps: ChatroomTransferDeps
): void {
  reportDryRun(summary, opts, deps);
  if (summary.imported > 0) deps.out('no agents were started');
  if (listing.kind === 'bundle') reportBundleSummary(summary, selected, deps);
}

function reportDryRun(
  summary: SelectedImportSummary,
  opts: ImportOptions,
  deps: ChatroomTransferDeps
): void {
  const dryRan = summary.results.some((result) => result.status === 'dry-run');
  if (opts.dryRun === true && dryRan) deps.out('dry run: nothing was written');
}

function reportBundleSummary(
  summary: SelectedImportSummary,
  selected: number,
  deps: ChatroomTransferDeps
): void {
  deps.out(`Imported ${summary.imported} of ${selected} selected; Failed: ${summary.failed}`);
  const ids = summary.results.flatMap((result) =>
    result.status === 'imported' ? [result.chatroomId] : []
  );
  if (ids.length > 0) deps.out(`new chatrooms: ${ids.join(', ')}`);
}

/** Builds the refusal the wrapper renders; the run's own lines are already printed. */
function summaryFailure(
  summary: SelectedImportSummary,
  listing: TransferListing,
  selected: number
): ChatroomTransferError {
  if (listing.kind === 'single') return singleFailure(summary);
  return bundleFailure(summary, selected);
}

function singleFailure(summary: SelectedImportSummary): ChatroomTransferError {
  const failed = summary.results.find(
    (result): result is Extract<EntryImportResult, { status: 'failed' }> =>
      result.status === 'failed'
  );
  if (failed === undefined) return cancelledError();
  return failedError(failed);
}

function failedError(
  failed: Extract<EntryImportResult, { status: 'failed' }>
): ChatroomTransferError {
  if (failed.code === TRANSFER_ERROR_CODES.IMPORT_ROLLBACK_FAILED)
    return rollbackFailedError(failed);
  if (failed.code === TRANSFER_ERROR_CODES.IMPORT_ROLLED_BACK) {
    return new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_ROLLED_BACK,
      failed.message,
      failed.details
    );
  }
  return new ChatroomTransferError(
    failed.code as TransferErrorCode,
    failed.message,
    failed.details
  );
}

function cancelledError(): ChatroomTransferError {
  return new ChatroomTransferError(
    TRANSFER_ERROR_CODES.IMPORT_ROLLED_BACK,
    'The import was cancelled before it started. No rows were kept.'
  );
}

function rollbackFailedError(
  failed: Extract<EntryImportResult, { status: 'failed' }>
): ChatroomTransferError {
  const orphan = failed.orphanChatroomId;
  return new ChatroomTransferError(
    TRANSFER_ERROR_CODES.IMPORT_ROLLBACK_FAILED,
    `The import did not complete and rollback did not finish. Chatroom ${orphan ?? 'unknown'} may still exist and may be active; archive or delete it in the webapp. It was not imported. ${failed.message}`,
    orphan === undefined ? failed.details : [orphan]
  );
}

function bundleFailure(summary: SelectedImportSummary, selected: number): ChatroomTransferError {
  const code = summary.results.some(
    (result) =>
      result.status === 'failed' && result.code === TRANSFER_ERROR_CODES.IMPORT_ROLLBACK_FAILED
  )
    ? TRANSFER_ERROR_CODES.IMPORT_ROLLBACK_FAILED
    : TRANSFER_ERROR_CODES.IMPORT_ROLLED_BACK;

  const message =
    `Imported ${summary.imported} of ${selected} selected; Failed: ${summary.failed}` +
    (summary.fatal === null ? '' : `; stopped: ${summary.fatal.message}`) +
    (summary.cancelled ? '; cancelled' : '');
  const details = summary.results.flatMap((result) =>
    result.status === 'failed' ? [`${result.key}: [${result.code}] ${result.message}`] : []
  );
  return new ChatroomTransferError(code, message, details);
}

/**
 * Prints what the import did or would do. Message creation times are always
 * listed because the driver sets them to import time, not their original time.
 */
function printPlan(deps: ChatroomTransferDeps, plan: ImportPlan, machineId: string): void {
  deps.out(`Machine: ${machineId}`);
  deps.out('counts:');
  for (const [category, count] of Object.entries(plan.report.counts)) {
    deps.out(`  ${category}: ${count}`);
  }
  for (const merge of plan.report.merged) {
    deps.out(`workspace ${merge.workingDir} merged: ${merge.keys.join(', ')}`);
  }
  deps.out(`agent configs restored: ${plan.report.agentConfigsRestored}`);
  for (const skipped of plan.report.agentConfigsSkipped) {
    deps.out(`  skipped agent config ${skipped.key}: ${skipped.reason}`);
  }
  deps.out(`tasks reset: ${plan.report.tasksReset}`);
  deps.out(`scheduled prompts paused: ${plan.report.scheduledPromptsDisabled}`);
  deps.out('message creation times were set to import time');
}
