import { BULK_CREATE_MAX_REPOSITORIES } from '@workspace/backend/src/domain/entities/repository-ledger';
import type { BulkCreateResult } from '@workspace/backend/src/domain/usecase/chatroom/create-chatrooms-for-working-dirs';

import { copyForErrorCode } from './machineErrorCopy';

export interface BulkCreatePlan {
  /** Working dirs for the next call: at most BULK_CREATE_MAX_REPOSITORIES, in list order. */
  batch: string[];
  /** Working dirs left after this batch. */
  remaining: number;
}

/** Plans the next call from the captured targets, starting at `offset`. */
export function planBulkCreate(paths: readonly string[], offset: number): BulkCreatePlan {
  const rest = paths.slice(offset);
  const batch = rest.slice(0, BULK_CREATE_MAX_REPOSITORIES);
  return { batch, remaining: rest.length - batch.length };
}

export interface BulkFailure {
  workingDir: string;
  reason: string;
}

export interface BulkCreateTotals {
  created: number;
  skipped: number;
  failed: number;
  failures: BulkFailure[];
}

export const EMPTY_BULK_TOTALS: BulkCreateTotals = {
  created: 0,
  skipped: 0,
  failed: 0,
  failures: [],
};

/** Mapped copy for the item's code, else the backend message. */
function failureReason(outcome: { code: string; message: string }): string {
  return copyForErrorCode(outcome.code) ?? outcome.message;
}

/** Adds one call's result to the running totals. */
export function addBulkResult(
  totals: BulkCreateTotals,
  result: BulkCreateResult
): BulkCreateTotals {
  const newFailures: BulkFailure[] = result.results.flatMap((outcome) =>
    outcome.outcome === 'failed'
      ? [{ workingDir: outcome.workingDir, reason: failureReason(outcome) }]
      : []
  );
  return {
    created: totals.created + result.created,
    skipped: totals.skipped + result.skipped,
    failed: totals.failed + result.failed,
    failures: [...totals.failures, ...newFailures],
  };
}

/** Why the bulk button is disabled, or null when it can run. Offline wins, then unknown connectivity, then loading. */
export function bulkCreateDisabledReason(input: {
  connected: boolean | undefined;
  isLoadingPages: boolean;
}): string | null {
  if (input.connected === false) return 'Machine is offline';
  if (input.connected === undefined) return 'Checking machine…';
  if (input.isLoadingPages) return 'Loading repositories…';
  return null;
}

/** '1 repository' or 'N repositories'. */
export function repositoryCount(count: number): string {
  return count === 1 ? '1 repository' : `${count} repositories`;
}

/** '1 chatroom' or 'N chatrooms'. */
export function chatroomCount(count: number): string {
  return count === 1 ? '1 chatroom' : `${count} chatrooms`;
}
