/**
 * `chatroom import` — read one export file, import it as a new chatroom.
 *
 * The backend owns validation, preflight, planning, the chunk loop, finalize and
 * rollback (`runImport`); this module only adapts `BackendOps` to the import
 * port, reads the file, maps OS signals to an abort, prints the plan/outcome and
 * maps a non-success outcome to a thrown `ChatroomTransferError`.
 *
 * Every failure is thrown to the command wrapper in `register.ts`, which renders
 * it as `❌ [CODE] message` and exits 1. No failure text says "success": a
 * rolled-back import did not complete, and a failed rollback leaves a room that
 * may be active and must be archived or deleted.
 */

import { resolve } from 'node:path';

import {
  ChatroomTransferError,
  EXPORT_MAX_FILE_BYTES,
  TRANSFER_ERROR_CODES,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import {
  runImport,
  type ChatroomImportPort,
  type ImportOutcome,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-driver';
import type { ImportPlan } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-plan';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { ChatroomTransferDeps } from './deps.js';
import { requireTransferSession } from './session-guard.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import type { BackendOps } from '../../infrastructure/deps/index.js';

export interface ImportOptions {
  path: string;
  machineId?: string | undefined;
  dryRun?: boolean | undefined;
}

/** Builds the port the driver calls. Tests substitute this seam; production uses `convexImportPort`. */
export type MakeImportPort = (backend: BackendOps, sessionId: SessionId) => ChatroomImportPort;

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
 * Imports `opts.path` as a new chatroom owned by the caller.
 *
 * The driver is the only place a step is decided or retried. This function
 * supplies the file, the machine identity, an abort signal for SIGINT/SIGTERM and
 * the output; a refusal or a failed write is thrown or reported, never swallowed.
 */
export async function importChatroom(
  opts: ImportOptions,
  deps: ChatroomTransferDeps,
  makePort: MakeImportPort = convexImportPort
): Promise<void> {
  const sessionId = await requireTransferSession(deps);
  if (sessionId === null) return;

  const json = await readExportText(deps, opts.path);
  const machineId = opts.machineId ?? (await deps.machine.getMachineId());
  if (!machineId) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_NO_MACHINE_IDENTITY,
      'This machine has no identity. Run `chatroom machine daemon start` or pass --machine-id.'
    );
  }

  // The listeners exist only while the driver runs; an abort is checked before
  // each chunk and before finalize, and any abort rolls the import back.
  const controller = new AbortController();
  const abort = () => controller.abort();
  deps.signals.on('SIGINT', abort);
  deps.signals.on('SIGTERM', abort);
  let outcome: ImportOutcome;
  try {
    outcome = await runImport(makePort(deps.backend, sessionId), {
      json,
      machineId,
      dryRun: opts.dryRun === true,
      signal: controller.signal,
      onStarted: (chatroomId) =>
        deps.out(
          `import started: chatroom ${chatroomId} (shows as completed until the import finishes)`
        ),
    });
  } finally {
    deps.signals.off('SIGINT', abort);
    deps.signals.off('SIGTERM', abort);
  }

  reportOutcome(outcome, machineId, deps);
}

/**
 * Reads the export text. A directory, a missing path or an unreadable file is
 * `IMPORT_FILE_UNREADABLE`; a file over `EXPORT_MAX_FILE_BYTES` is
 * `IMPORT_FILE_TOO_LARGE` and is never read. The driver then validates the
 * contents.
 */
async function readExportText(deps: ChatroomTransferDeps, path: string): Promise<string> {
  const full = resolve(deps.cwd(), path);
  const stats = await deps.fs.stat(full).catch((error: unknown) => {
    throw unreadable(full, reasonOf(error));
  });
  if (!stats.isFile) throw unreadable(full);
  if (stats.size > EXPORT_MAX_FILE_BYTES) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_FILE_TOO_LARGE,
      `file is larger than ${EXPORT_MAX_FILE_BYTES} bytes: ${full}`
    );
  }
  return await deps.fs.readFile(full).catch((error: unknown) => {
    throw unreadable(full, reasonOf(error));
  });
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

/** Maps each driver outcome to its printed report or its thrown refusal. */
function reportOutcome(
  outcome: ImportOutcome,
  machineId: string,
  deps: ChatroomTransferDeps
): void {
  if (outcome.status === 'dry-run') {
    printPlan(deps, outcome.plan, machineId);
    deps.out('dry run: nothing was written');
    return;
  }
  if (outcome.status === 'imported') {
    deps.out(`Imported as new chatroom ${outcome.chatroomId}`);
    printPlan(deps, outcome.plan, machineId);
    deps.out('no agents were started');
    return;
  }
  throwOutcomeFailure(outcome);
}

/** The two non-success outcomes are refusals; the caller renders and exits. */
function throwOutcomeFailure(
  outcome: Extract<ImportOutcome, { status: 'rolled-back' | 'rollback-failed' }>
): never {
  if (outcome.status === 'rolled-back') {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.IMPORT_ROLLED_BACK,
      `The import did not complete and was rolled back. No rows were kept. Cause: ${outcome.cause.message}`
    );
  }
  throw new ChatroomTransferError(
    TRANSFER_ERROR_CODES.IMPORT_ROLLBACK_FAILED,
    `The import did not complete and rollback did not finish. Chatroom ${outcome.orphanChatroomId} may still exist and may be active; archive or delete it in the webapp. It was not imported. Cause: ${outcome.cause.message}. Rollback error: ${outcome.rollbackError.message}`,
    [outcome.orphanChatroomId]
  );
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
