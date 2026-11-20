/**
 * Repository ledger service: orchestrates roots → scan → local store.
 *
 * Constraints this module guarantees:
 * - Local only: no Convex writes, no uploads. The only backend call is the
 *   roots query behind the injected `fetchRoots` port.
 * - No polling: no timers and no filesystem watchers. Refreshes happen only
 *   when a caller triggers one (daemon boot, `daemon.syncProjectRoots`).
 * - Coalesced: exactly one scan runs at a time. A trigger during a scan sets a
 *   dirty flag, and one rerun happens after the current pass with freshly
 *   fetched roots, so a nudge is never lost.
 * - `refresh` never rejects and never throws synchronously. Failures are
 *   logged and the store keeps its previous contents.
 * - `discoveredAt` is carried forward by repository path across refreshes.
 */

import type { ScanResult } from '../../../infrastructure/local-actions/scan-repositories.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type {
  LedgerEntry,
  RepositoryLedgerStore,
  StoredLedger,
} from '../../infrastructure/local/repository-ledger-store.js';

export type RepositoryLedgerRefreshReason = 'boot' | 'roots-changed' | 'manual';

export interface RepositoryLedgerPorts {
  /** Backed by api.machineProjectRoots.list → paths. */
  fetchRoots: () => Promise<string[]>;
  /** Backed by scanRepositories({ roots }). */
  scan: (roots: string[]) => Promise<ScanResult>;
  store: RepositoryLedgerStore;
  now: () => number;
}

export interface RepositoryLedgerService {
  /** Never rejects. Coalesces concurrent triggers (one scan at a time, rerun once if dirtied). */
  refresh: (reason: RepositoryLedgerRefreshReason) => Promise<void>;
}

interface RefreshState {
  running: Promise<void> | null;
  dirty: boolean;
}

/** Same format as the entry layer's `formatTimestamp`. Domain code does not import from entry. */
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function warnRefreshFailed(reason: RepositoryLedgerRefreshReason, error: unknown): void {
  console.warn(
    `[${formatTimestamp()}] ⚠️  Repository ledger refresh failed during ${reason} refresh: ${getErrorMessage(error)}`
  );
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
): Promise<void> {
  const previous = await readPrevious(ports, reason);
  const roots = await resolveRoots(ports, reason, previous);
  if (roots === null) return;
  if (roots.length === 0) {
    await ports.store.clear();
    return;
  }

  const scan = await ports.scan(roots);
  await ports.store.write(buildLedger(scan, roots, previous, ports.now()));
}

async function runLoop(
  ports: RepositoryLedgerPorts,
  state: RefreshState,
  reason: RepositoryLedgerRefreshReason
): Promise<void> {
  try {
    do {
      state.dirty = false;
      try {
        await runOnce(ports, reason);
      } catch (error) {
        // A failed pass must not stop a pending rerun.
        warnRefreshFailed(reason, error);
      }
    } while (state.dirty);
  } finally {
    state.running = null;
  }
}

export function createRepositoryLedgerService(
  ports: RepositoryLedgerPorts
): RepositoryLedgerService {
  const state: RefreshState = { running: null, dirty: false };

  return {
    refresh(reason) {
      if (state.running) {
        state.dirty = true;
        return state.running;
      }
      state.running = runLoop(ports, state, reason);
      return state.running;
    },
  };
}
