/**
 * Latest-wins folder-browse fulfiller.
 *
 * The daemon subscribes to `api.folderBrowse.daemonPending` and hands every snapshot to
 * `onPending`. This service owns the daemon-side policy:
 * - dedup: one (browseId, navSeq) pair is listed at most once;
 * - latest wins: only the newest navSeq per browse is listed, older queued work is replaced;
 * - cancellation: queued work and completed listings for a browse absent from the newest
 *   snapshot are dropped (never reported);
 * - bounded concurrency: at most `concurrency` (default 2) listings run at once, and at most one
 *   per browseId (a newer navSeq waits for the in-flight run, then starts);
 * - one report retry, then the report is logged and dropped (the UI shows no-response and the
 *   user can retry).
 */

import type {
  ListBrowseDirectoryInput,
  ListBrowseDirectoryResult,
} from '../../../infrastructure/local-actions/list-browse-directory.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

export interface PendingFolderBrowse {
  browseId: string;
  navSeq: number;
  path: string | null;
  showHidden: boolean;
  filter: string | null;
}

export interface FolderBrowseReportOutcome {
  outcome: string;
}

export interface FolderBrowseServicePorts {
  listDirectory: (input: ListBrowseDirectoryInput) => Promise<ListBrowseDirectoryResult>;
  reportListing: (args: {
    browseId: string;
    navSeq: number;
    result: ListBrowseDirectoryResult;
  }) => Promise<FolderBrowseReportOutcome>;
}

export interface FolderBrowseServiceOptions {
  concurrency?: number;
  reportRetryDelayMs?: number;
}

export interface FolderBrowseService {
  /** Feeds one pending snapshot. Never throws. */
  onPending: (rows: readonly PendingFolderBrowse[] | null) => void;
  /** Stops accepting work, drops queued rows, and cancels any pending retry delay. */
  stop: () => void;
}

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_REPORT_RETRY_DELAY_MS = 1_000;
/** One initial attempt plus one retry. */
const REPORT_ATTEMPTS = 2;

/** Same format as the entry layer's `formatTimestamp`. Domain code does not import from entry. */
// fallow-ignore-next-line code-duplication
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function warn(message: string): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${message}`);
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}

export function createFolderBrowseService(
  ports: FolderBrowseServicePorts,
  options: FolderBrowseServiceOptions = {}
): FolderBrowseService {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const retryDelayMs = options.reportRetryDelayMs ?? DEFAULT_REPORT_RETRY_DELAY_MS;

  /** Highest navSeq accepted per browse. Dropped when the browse leaves the snapshot. */
  const handled = new Map<string, number>();
  /** Newest accepted row per browse, waiting for a concurrency slot. */
  const queued = new Map<string, PendingFolderBrowse>();
  /** Browse ids of the newest snapshot. A completed listing outside it is never reported. */
  const present = new Set<string>();
  /** Cancel functions for report retries still waiting out their delay. */
  const retryWaits = new Set<() => void>();
  /** Browse ids with a listing in flight, so a newer navSeq never runs in parallel with it. */
  const running = new Set<string>();

  let active = 0;
  let stopped = false;

  /** Resolves after `retryDelayMs`, or immediately when `stop()` cancels the wait. */
  function delayBeforeRetry(): Promise<void> {
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(handle);
        retryWaits.delete(finish);
        resolve();
      };
      const handle = setTimeout(finish, retryDelayMs);
      unrefTimer(handle);
      retryWaits.add(finish);
    });
  }

  /** Dedup, latest-wins and cancellation in one pass over the newest snapshot. */
  // fallow-ignore-next-line complexity
  function applySnapshot(rows: readonly PendingFolderBrowse[] | null): void {
    present.clear();
    for (const row of rows ?? []) present.add(row.browseId);

    for (const browseId of [...handled.keys()]) {
      if (!present.has(browseId)) handled.delete(browseId);
    }
    for (const browseId of [...queued.keys()]) {
      if (!present.has(browseId)) queued.delete(browseId);
    }

    for (const row of rows ?? []) {
      if (row.navSeq <= (handled.get(row.browseId) ?? 0)) continue;
      handled.set(row.browseId, row.navSeq);
      queued.set(row.browseId, row);
    }
  }

  // fallow-ignore-next-line complexity
  async function reportWithRetry(
    row: PendingFolderBrowse,
    result: ListBrowseDirectoryResult
  ): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < REPORT_ATTEMPTS; attempt += 1) {
      try {
        const { outcome } = await ports.reportListing({
          browseId: row.browseId,
          navSeq: row.navSeq,
          result,
        });
        if (outcome !== 'applied') {
          console.debug(
            `[folder-browse] report ignored for ${row.browseId} navSeq ${row.navSeq}: ${outcome}`
          );
        }
        return;
      } catch (error) {
        lastError = error;
      }
      if (attempt < REPORT_ATTEMPTS - 1) {
        await delayBeforeRetry();
        if (stopped) return;
      }
    }
    warn(
      `Folder browse report failed for ${row.browseId} navSeq ${row.navSeq}: ${getErrorMessage(lastError)}`
    );
  }

  async function runRow(row: PendingFolderBrowse): Promise<void> {
    try {
      const result = await ports.listDirectory({
        path: row.path,
        showHidden: row.showHidden,
        filter: row.filter,
      });
      if (stopped || !present.has(row.browseId)) return;
      await reportWithRetry(row, result);
    } catch (error) {
      warn(
        `Folder browse listing failed for ${row.browseId} navSeq ${row.navSeq}: ${getErrorMessage(error)}`
      );
    }
  }

  // fallow-ignore-next-line complexity
  function pump(): void {
    while (!stopped && active < concurrency) {
      const next = [...queued.values()].find((row) => !running.has(row.browseId));
      if (next === undefined) return;
      queued.delete(next.browseId);
      running.add(next.browseId);
      active += 1;
      void runRow(next).finally(() => {
        active -= 1;
        running.delete(next.browseId);
        pump();
      });
    }
  }

  return {
    onPending(rows) {
      if (stopped) return;
      try {
        applySnapshot(rows);
        pump();
      } catch (error) {
        warn(`Folder browse snapshot failed: ${getErrorMessage(error)}`);
      }
    },
    stop() {
      stopped = true;
      queued.clear();
      handled.clear();
      present.clear();
      for (const cancel of [...retryWaits]) cancel();
    },
  };
}
