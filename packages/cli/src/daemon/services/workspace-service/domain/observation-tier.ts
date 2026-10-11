// Reason: the WorkspaceService sync loop that consumes these tiers is not wired until S4/S5.
// fallow-ignore-file unused-file
import type { WorkspaceSyncPolicy } from './workspace-sync-policy.js';
import { normalizeWorkingDirForLookup } from '../../../../infrastructure/services/workspace/normalize-working-dir.js';

/** One workspace as reported by the activity source. `lastObservedAt` is the remote's epoch-ms stamp, or null if unknown. */
export type WorkspaceActivityRow = { workingDir: string; lastObservedAt: number | null };

/** `observed` keys are synced on the hot cadence; `idle` keys on the slow one. */
export type ObservationTier = 'observed' | 'idle';

export type ObservationTracker = {
  /** Reconciles the tracked set with `rows`. Keys are normalized with `normalizeWorkingDirForLookup`. */
  apply(rows: readonly WorkspaceActivityRow[]): {
    added: string[];
    removed: string[];
    tierChanged: string[];
  };
  /** Live tier of `workingDir` at the current clock. Unknown keys are `idle`. */
  tierOf(workingDir: string): ObservationTier;
  /** Earliest future instant at which an observed key decays to idle, or null when none is observed. */
  nextTransitionAt(): number | null;
  has(workingDir: string): boolean;
  list(): string[];
};

type TrackedKey = {
  /** High-water mark of every `lastObservedAt` seen for this key; null until one is seen. */
  lastObservedAt: number | null;
  /** Epoch ms until which the key counts as observed. 0 (or any past instant) means idle. */
  observedUntil: number;
  /** Tier recorded at the end of the most recent `apply`. Baseline for `tierChanged`. */
  reportedTier: ObservationTier;
};

/** Larger of two timestamps, where null means "no timestamp" and loses to any number. */
function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function tierAt(observedUntil: number, t: number): ObservationTier {
  return observedUntil > t ? 'observed' : 'idle';
}

/**
 * Tracks which workspaces have recent activity. Uses only the injected clock and the age of each
 * row (`now() - lastObservedAt`), never the remote's absolute time, so clock skew between the
 * machine and the activity source does not change the result beyond `initialSkewAllowanceMs`.
 */
export function createObservationTracker(
  policy: WorkspaceSyncPolicy['observation'],
  now: () => number
): ObservationTracker {
  const keys = new Map<string, TrackedKey>();

  /** A key seen for the first time is observed only if its row's age is within the skew allowance. */
  function firstSightObservedUntil(lastObservedAt: number | null, t: number): number {
    const recent =
      lastObservedAt !== null && t - lastObservedAt < policy.ttlMs + policy.initialSkewAllowanceMs;
    return recent ? t + policy.ttlMs + policy.graceMs : 0;
  }

  /** Coalesces duplicate rows for one key to the maximum non-null `lastObservedAt`. */
  function mergeRows(rows: readonly WorkspaceActivityRow[]): Map<string, number | null> {
    const merged = new Map<string, number | null>();
    for (const row of rows) {
      const key = normalizeWorkingDirForLookup(row.workingDir);
      merged.set(key, maxNullable(merged.get(key) ?? null, row.lastObservedAt));
    }
    return merged;
  }

  function newEntry(lastObservedAt: number | null, t: number): TrackedKey {
    const observedUntil = firstSightObservedUntil(lastObservedAt, t);
    return { lastObservedAt, observedUntil, reportedTier: tierAt(observedUntil, t) };
  }

  /** Drops keys absent from `merged` and returns them. */
  function dropMissing(merged: Map<string, number | null>): string[] {
    const removed = Array.from(keys.keys()).filter((key) => !merged.has(key));
    for (const key of removed) keys.delete(key);
    return removed;
  }

  /**
   * Only a strictly newer timestamp is a fresh observation. Equal or older timestamps change
   * nothing, so re-sending a stale row cannot revive a key that has decayed.
   */
  function refreshObservation(entry: TrackedKey, lastObservedAt: number | null, t: number): void {
    if (lastObservedAt === null) return;
    if (entry.lastObservedAt !== null && lastObservedAt <= entry.lastObservedAt) return;
    entry.lastObservedAt = lastObservedAt;
    entry.observedUntil = t + policy.ttlMs + policy.graceMs;
  }

  /** Records the tier at `t`; returns true when it differs from the tier recorded last apply. */
  function recordTier(entry: TrackedKey, t: number): boolean {
    const tier = tierAt(entry.observedUntil, t);
    if (tier === entry.reportedTier) return false;
    entry.reportedTier = tier;
    return true;
  }

  return {
    apply(rows) {
      const t = now();
      const merged = mergeRows(rows);
      const removed = dropMissing(merged);
      const added: string[] = [];
      const tierChanged: string[] = [];

      for (const [key, lastObservedAt] of merged) {
        const existing = keys.get(key);
        if (existing === undefined) {
          keys.set(key, newEntry(lastObservedAt, t));
          added.push(key);
          continue;
        }
        refreshObservation(existing, lastObservedAt, t);
        if (recordTier(existing, t)) tierChanged.push(key);
      }

      return { added, removed, tierChanged };
    },

    tierOf(workingDir) {
      const entry = keys.get(normalizeWorkingDirForLookup(workingDir));
      return entry ? tierAt(entry.observedUntil, now()) : 'idle';
    },

    nextTransitionAt() {
      const t = now();
      let next: number | null = null;
      for (const entry of keys.values()) {
        if (entry.observedUntil <= t) continue;
        next = next === null ? entry.observedUntil : Math.min(next, entry.observedUntil);
      }
      return next;
    },

    has(workingDir) {
      return keys.has(normalizeWorkingDirForLookup(workingDir));
    },

    list() {
      return Array.from(keys.keys()).sort();
    },
  };
}
