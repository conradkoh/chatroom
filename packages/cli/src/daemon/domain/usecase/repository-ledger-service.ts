/**
 * Repository ledger service: orchestrates roots → scan → local store, and answers
 * on-demand snapshot requests from the backend.
 *
 * Constraints this module guarantees:
 * - Local only. The backend is read once (roots, through `fetchRoots`) and written
 *   only by the explicit snapshot report. No upload happens on boot, rescan or roots change.
 * - No polling: no periodic timers and no filesystem watchers. The only timer is the
 *   report retry backoff. Refreshes happen only when a caller triggers one (daemon boot,
 *   `daemon.syncProjectRoots`) or a snapshot needs a scan.
 * - Coalesced: exactly one scan runs at a time. A trigger during a scan sets a dirty
 *   flag, and one rerun happens after the current pass with freshly fetched roots.
 * - `refresh` and `serveSnapshot` never reject. Refresh failures are returned as an
 *   outcome and logged; the store keeps its previous contents.
 * - `discoveredAt` is carried forward by repository path across refreshes.
 * - Snapshot payloads respect the wire caps in SNAPSHOT_WIRE_CAPS; over-cap values are
 *   dropped, never truncated.
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel.js';

import type { ScanResult } from '../../../infrastructure/local-actions/scan-repositories.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type {
  LedgerEntry,
  RepositoryLedgerStore,
  StoredLedger,
} from '../../infrastructure/local/repository-ledger-store.js';

export type RepositoryLedgerRefreshReason = 'boot' | 'roots-changed' | 'manual';

export type RepositoryLedgerRefreshOutcome = { ok: true } | { ok: false; errorMessage: string };

const REFRESH_OK: RepositoryLedgerRefreshOutcome = { ok: true };

/** Backend-enforced limits, mirrored here. Over-cap values are dropped, never truncated. */
// fallow-ignore-next-line unused-export
export const SNAPSHOT_WIRE_CAPS = {
  path: 1024,
  root: 1024,
  name: 256,
  branch: 256,
  remoteUrl: 2048,
  roots: 20,
  entries: 1000,
} as const;

/** Wait before each snapshot-report retry. One initial attempt plus one retry per entry. */
const SNAPSHOT_REPORT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export type LedgerRequestId = Id<'chatroom_repositoryLedgerRequests'>;

export interface SnapshotWireEntry {
  path: string;
  name: string;
  root: string;
  branch?: string;
  remoteUrl?: string;
  discoveredAt: number;
}

export interface SnapshotWireRoot {
  path: string;
  status: 'ok' | 'missing' | 'unreadable';
  repositoryCount: number;
}

export type RepositoryLedgerSnapshotReport =
  | {
      requestId: LedgerRequestId;
      status: 'completed';
      entries: SnapshotWireEntry[];
      truncated: boolean;
      /**
       * Entries omitted from `entries` because they were over the wire caps or duplicate paths.
       * Entries past SNAPSHOT_WIRE_CAPS.entries are not counted; they set `truncated`.
       */
      droppedEntryCount: number;
      roots: SnapshotWireRoot[];
      ledgerGeneratedAt?: number;
    }
  | { requestId: LedgerRequestId; status: 'failed'; errorMessage: string };

export interface SnapshotRequest {
  requestId: LedgerRequestId;
  rescan: boolean;
}

export interface RepositoryLedgerPorts {
  /** Backed by api.machineProjectRoots.list → paths. */
  fetchRoots: () => Promise<string[]>;
  /** Backed by scanRepositories({ roots }). */
  scan: (roots: string[]) => Promise<ScanResult>;
  store: RepositoryLedgerStore;
  now: () => number;
  /** Backed by api.repositoryLedger.reportResult. The bridge adds sessionId and machineId. */
  reportSnapshot: (report: RepositoryLedgerSnapshotReport) => Promise<unknown>;
}

export interface RepositoryLedgerService {
  /** Never rejects. Coalesces concurrent triggers. Resolves with the outcome of the last pass. */
  refresh: (reason: RepositoryLedgerRefreshReason) => Promise<RepositoryLedgerRefreshOutcome>;
  /**
   * Synchronous start. The snapshot job runs in the background and never rejects.
   * Returns 'duplicate' when a job for this requestId is already in flight (nothing starts).
   */
  serveSnapshot: (request: SnapshotRequest) => 'started' | 'duplicate';
}

interface RefreshState {
  running: Promise<RepositoryLedgerRefreshOutcome> | null;
  dirty: boolean;
}

/** Same format as the entry layer's `formatTimestamp`. Domain code does not import from entry. */
// fallow-ignore-next-line code-duplication
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function warn(message: string): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${message}`);
}

function warnRefreshFailed(reason: RepositoryLedgerRefreshReason, error: unknown): void {
  warn(`Repository ledger refresh failed during ${reason} refresh: ${getErrorMessage(error)}`);
}

/** Stored ledger, or null. `store.read` never throws by contract; guard anyway. */
async function readPrevious(
  ports: RepositoryLedgerPorts,
  reason: RepositoryLedgerRefreshReason
): Promise<StoredLedger | null> {
  try {
    return await ports.store.read();
  } catch (error) {
    warnRefreshFailed(reason, error);
    return null;
  }
}

/**
 * Roots to fall back to when the fetch fails: the previous ledger's roots, or
 * null when nothing usable is stored (skip without clearing or scanning).
 */
function fallbackRoots(previous: StoredLedger | null): string[] | null {
  if (previous === null || previous.roots.length === 0) return null;
  return previous.roots;
}

/**
 * Fetched roots, or null when the fetch failed and nothing usable is stored.
 * A failed fetch falls back to the previous ledger's roots; it never clears.
 */
async function resolveRoots(
  ports: RepositoryLedgerPorts,
  reason: RepositoryLedgerRefreshReason,
  previous: StoredLedger | null
): Promise<string[] | null> {
  try {
    return await ports.fetchRoots();
  } catch (error) {
    warnRefreshFailed(reason, error);
    return fallbackRoots(previous);
  }
}

/** Stamps new paths with `now` and carries `discoveredAt` forward by path. */
function buildLedger(
  scan: ScanResult,
  roots: string[],
  previous: StoredLedger | null,
  now: number
): StoredLedger {
  const discoveredAtByPath = new Map<string, number>();
  for (const entry of previous?.entries ?? []) {
    discoveredAtByPath.set(entry.path, entry.discoveredAt);
  }
  const entries: LedgerEntry[] = scan.repositories.map((repository) => ({
    ...repository,
    discoveredAt: discoveredAtByPath.get(repository.path) ?? now,
  }));
  return {
    version: 1,
    generatedAt: now,
    roots,
    rootStatuses: scan.roots,
    truncated: scan.truncated,
    entries,
  };
}

async function runOnce(
  ports: RepositoryLedgerPorts,
  reason: RepositoryLedgerRefreshReason
): Promise<RepositoryLedgerRefreshOutcome> {
  const previous = await readPrevious(ports, reason);
  const roots = await resolveRoots(ports, reason, previous);
  if (roots === null) return { ok: false, errorMessage: 'Project roots could not be read' };
  if (roots.length === 0) {
    await ports.store.clear();
    return REFRESH_OK;
  }

  const scan = await ports.scan(roots);
  await ports.store.write(buildLedger(scan, roots, previous, ports.now()));
  return REFRESH_OK;
}

/** One pass. A throw becomes a failed outcome; it never escapes. */
async function runPass(
  ports: RepositoryLedgerPorts,
  reason: RepositoryLedgerRefreshReason
): Promise<RepositoryLedgerRefreshOutcome> {
  try {
    return await runOnce(ports, reason);
  } catch (error) {
    // A failed pass must not stop a pending rerun.
    warnRefreshFailed(reason, error);
    return { ok: false, errorMessage: getErrorMessage(error) };
  }
}

async function runLoop(
  ports: RepositoryLedgerPorts,
  state: RefreshState,
  reason: RepositoryLedgerRefreshReason
): Promise<RepositoryLedgerRefreshOutcome> {
  try {
    let outcome: RepositoryLedgerRefreshOutcome = REFRESH_OK;
    do {
      state.dirty = false;
      outcome = await runPass(ports, reason);
    } while (state.dirty);
    return outcome;
  } finally {
    state.running = null;
  }
}

/** Wire entry: omits null optionals. Input is a stored entry, already within caps. */
function toWireEntry(entry: LedgerEntry): SnapshotWireEntry {
  return {
    path: entry.path,
    name: entry.name,
    root: entry.root,
    discoveredAt: entry.discoveredAt,
    ...(entry.branch != null ? { branch: entry.branch } : {}),
    ...(entry.remoteUrl != null ? { remoteUrl: entry.remoteUrl } : {}),
  };
}

/** True when the value is absent or within the backend's cap for that field. */
function withinCap(value: string | null, cap: number): boolean {
  return value == null || value.length <= cap;
}

function fitsWireCaps(entry: LedgerEntry): boolean {
  return [
    withinCap(entry.path, SNAPSHOT_WIRE_CAPS.path),
    withinCap(entry.root, SNAPSHOT_WIRE_CAPS.root),
    withinCap(entry.name, SNAPSHOT_WIRE_CAPS.name),
    withinCap(entry.branch, SNAPSHOT_WIRE_CAPS.branch),
    withinCap(entry.remoteUrl, SNAPSHOT_WIRE_CAPS.remoteUrl),
  ].every(Boolean);
}

type EntrySelection = 'duplicate' | 'over-cap' | 'kept';

/** First entry per path wins; an over-cap entry is dropped instead of truncated. */
function selectEntry(entry: LedgerEntry, seenPaths: Set<string>): EntrySelection {
  if (seenPaths.has(entry.path)) return 'duplicate';
  seenPaths.add(entry.path);
  return fitsWireCaps(entry) ? 'kept' : 'over-cap';
}

function isTruncated(stored: StoredLedger, keptCount: number): boolean {
  return stored.truncated || keptCount > SNAPSHOT_WIRE_CAPS.entries;
}

/** Walks stored entries once, keeping the first entry per path that fits the wire caps. */
function collectEntries(stored: StoredLedger): {
  kept: SnapshotWireEntry[];
  droppedCount: number;
} {
  const seenPaths = new Set<string>();
  const kept: SnapshotWireEntry[] = [];
  let droppedCount = 0;
  for (const entry of stored.entries) {
    const selection = selectEntry(entry, seenPaths);
    if (selection === 'kept') kept.push(toWireEntry(entry));
    else droppedCount += 1;
  }
  return { kept, droppedCount };
}

/**
 * Entries for one report. First entry per path wins. Over-cap and duplicate entries are dropped and
 * counted in `droppedCount` (logged, not sent). Entries past SNAPSHOT_WIRE_CAPS.entries are dropped
 * and mark the report truncated.
 */
function toSnapshotEntries(stored: StoredLedger): {
  entries: SnapshotWireEntry[];
  truncated: boolean;
  droppedCount: number;
} {
  const { kept, droppedCount } = collectEntries(stored);
  if (droppedCount > 0) {
    warn(
      `Repository ledger snapshot dropped ${droppedCount} entries (over-cap or duplicate paths)`
    );
  }
  return {
    entries: kept.slice(0, SNAPSHOT_WIRE_CAPS.entries),
    truncated: isTruncated(stored, kept.length),
    droppedCount,
  };
}

function toWireRoots(stored: StoredLedger): SnapshotWireRoot[] {
  return stored.rootStatuses.slice(0, SNAPSHOT_WIRE_CAPS.roots).map((root) => ({
    path: root.path,
    status: root.status,
    repositoryCount: root.repositoryCount,
  }));
}

/** `stored` null means the ledger is empty (for example, no roots). That is a valid, empty snapshot. */
function completedReport(
  requestId: LedgerRequestId,
  stored: StoredLedger | null
): RepositoryLedgerSnapshotReport {
  if (stored === null) {
    return {
      requestId,
      status: 'completed',
      entries: [],
      truncated: false,
      droppedEntryCount: 0,
      roots: [],
    };
  }
  const { entries, truncated, droppedCount } = toSnapshotEntries(stored);
  return {
    requestId,
    status: 'completed',
    entries,
    truncated,
    droppedEntryCount: droppedCount,
    roots: toWireRoots(stored),
    ledgerGeneratedAt: stored.generatedAt,
  };
}

/** Sends one report. Transient failures retry on the fixed schedule, then log. Never rejects. */
async function reportSnapshotWithRetry(
  ports: RepositoryLedgerPorts,
  report: RepositoryLedgerSnapshotReport
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await ports.reportSnapshot(report);
      return;
    } catch (error) {
      const delayMs = SNAPSHOT_REPORT_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) {
        warn(`Repository ledger snapshot report failed after retries: ${getErrorMessage(error)}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

type RefreshFn = (reason: RepositoryLedgerRefreshReason) => Promise<RepositoryLedgerRefreshOutcome>;

/**
 * Builds the report for one request. Rule: a stored ledger serves a non-rescan request with no
 * scan; otherwise the service refreshes (joining an in-flight scan) and reads the result.
 */
async function buildSnapshotReport(
  ports: RepositoryLedgerPorts,
  refresh: RefreshFn,
  request: SnapshotRequest
): Promise<RepositoryLedgerSnapshotReport> {
  if (!request.rescan) {
    const cached = await readPrevious(ports, 'manual');
    if (cached !== null) return completedReport(request.requestId, cached);
  }
  const outcome = await refresh('manual');
  if (!outcome.ok) {
    return { requestId: request.requestId, status: 'failed', errorMessage: outcome.errorMessage };
  }
  return completedReport(request.requestId, await readPrevious(ports, 'manual'));
}

/** Background job. Builds and reports one snapshot. Never rejects. */
async function runSnapshotJob(
  ports: RepositoryLedgerPorts,
  refresh: RefreshFn,
  request: SnapshotRequest
): Promise<void> {
  let report: RepositoryLedgerSnapshotReport;
  try {
    report = await buildSnapshotReport(ports, refresh, request);
  } catch (error) {
    report = {
      requestId: request.requestId,
      status: 'failed',
      errorMessage: getErrorMessage(error),
    };
  }
  await reportSnapshotWithRetry(ports, report);
}

export function createRepositoryLedgerService(
  ports: RepositoryLedgerPorts
): RepositoryLedgerService {
  const state: RefreshState = { running: null, dirty: false };
  const snapshotsInFlight = new Set<string>();

  const refresh: RefreshFn = (reason) => {
    if (state.running) {
      state.dirty = true;
      return state.running;
    }
    state.running = runLoop(ports, state, reason);
    return state.running;
  };

  return {
    refresh,
    serveSnapshot(request) {
      const key = request.requestId;
      if (snapshotsInFlight.has(key)) return 'duplicate';
      snapshotsInFlight.add(key);
      void runSnapshotJob(ports, refresh, request).finally(() => {
        snapshotsInFlight.delete(key);
      });
      return 'started';
    },
  };
}
