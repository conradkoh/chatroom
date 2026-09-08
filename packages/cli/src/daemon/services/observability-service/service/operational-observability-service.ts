// fallow-ignore-file unused-export
/**
 * Daemon-local operational-signal observability aggregation.
 *
 * This service is diagnostic-only. It aggregates operational subscription
 * lifecycle, page/source, hydration, acknowledgement, error, and restart
 * counters in memory and emits at most one schema-versioned snapshot per
 * flush interval through an injected sink.
 *
 * Constraints:
 * - No timers, network clients, database access, console output, or Convex
 *   imports belong in this service. The runtime owns the flush timer and
 *   supplies the daemon-local event-stream sink.
 * - Aggregation memory is bounded: at most `scopeLimit` chatroom scope
 *   buckets and `roleLimit` role buckets per scope; overflow aggregates
 *   into stable `__other__` buckets.
 * - Snapshots carry only counts and chatroom/role attribution. They never
 *   include session ids, auth tokens, signal keys, revision keys, message
 *   content, or full rows.
 */

export const OPERATIONAL_OBSERVABILITY_SCHEMA_VERSION = 1;
export const DEFAULT_OBSERVABILITY_SCOPE_LIMIT = 64;
export const DEFAULT_OBSERVABILITY_ROLE_LIMIT = 32;

const OTHER_BUCKET = '__other__';

export type OperationalObservabilityScopeSnapshot = {
  readonly chatroomId: string;
  readonly pageCount: number;
  readonly signalCount: number;
  readonly hydrationCount: number;
  readonly hydratedRowCount: number;
  readonly removedRowCount: number;
  readonly acknowledgementCount: number;
  readonly errorCount: number;
  readonly restartCount: number;
  readonly roleCounts: Readonly<Record<string, number>>;
  readonly lastSignalAt?: number | undefined;
};

export type OperationalObservabilitySnapshot = {
  readonly type: 'daemon.observability.operational-signals';
  readonly schemaVersion: 1;
  readonly machineId: string;
  readonly timestamp: number;
  readonly intervalStartedAt: number;
  readonly activeSubscriptions: number;
  readonly totals: {
    readonly subscriptionStarts: number;
    readonly subscriptionStops: number;
    readonly pageCount: number;
    readonly signalCount: number;
    readonly hydrationCount: number;
    readonly hydratedRowCount: number;
    readonly removedRowCount: number;
    readonly acknowledgementCount: number;
    readonly errorCount: number;
    readonly restartCount: number;
  };
  readonly scopes: readonly OperationalObservabilityScopeSnapshot[];
};

export type OperationalObservabilitySink = (
  snapshot: OperationalObservabilitySnapshot
) => Promise<void> | void;

export interface OperationalObservabilityService {
  subscriptionStarted(chatroomId: string): void;
  subscriptionStopped(chatroomId: string): void;
  signalPageReceived(
    chatroomId: string,
    signals: readonly { role: string; projectedAt: number }[]
  ): void;
  hydrationCompleted(
    chatroomId: string,
    result: { rowCount: number; removedRowCount: number }
  ): void;
  acknowledgementAttempted(chatroomId: string): void;
  loopError(chatroomId: string): void;
  loopRestart(chatroomId: string): void;
  snapshot(): OperationalObservabilitySnapshot;
  flush(): Promise<void>;
}

interface ScopeBucketState {
  pageCount: number;
  signalCount: number;
  hydrationCount: number;
  hydratedRowCount: number;
  removedRowCount: number;
  acknowledgementCount: number;
  errorCount: number;
  restartCount: number;
  /** Insertion-ordered role counts; bounded to roleLimit + 1 (`__other__`). */
  roleCounts: Map<string, number>;
  /** Distinct non-`__other__` roles retained; bounded by roleLimit. */
  distinctRoles: number;
  lastSignalAt: number | undefined;
}

interface IntervalTotals {
  subscriptionStarts: number;
  subscriptionStops: number;
  pageCount: number;
  signalCount: number;
  hydrationCount: number;
  hydratedRowCount: number;
  removedRowCount: number;
  acknowledgementCount: number;
  errorCount: number;
  restartCount: number;
}

function zeroTotals(): IntervalTotals {
  return {
    subscriptionStarts: 0,
    subscriptionStops: 0,
    pageCount: 0,
    signalCount: 0,
    hydrationCount: 0,
    hydratedRowCount: 0,
    removedRowCount: 0,
    acknowledgementCount: 0,
    errorCount: 0,
    restartCount: 0,
  };
}

function createScopeBucket(): ScopeBucketState {
  return {
    pageCount: 0,
    signalCount: 0,
    hydrationCount: 0,
    hydratedRowCount: 0,
    removedRowCount: 0,
    acknowledgementCount: 0,
    errorCount: 0,
    restartCount: 0,
    roleCounts: new Map(),
    distinctRoles: 0,
    lastSignalAt: undefined,
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

export function createOperationalObservabilityService(options: {
  machineId: string;
  sink?: OperationalObservabilitySink | undefined;
  clock?: (() => number) | undefined;
  scopeLimit?: number | undefined;
  roleLimit?: number | undefined;
}): OperationalObservabilityService {
  const machineId = options.machineId;
  const sink = options.sink;
  const clock = options.clock ?? (() => Date.now());
  const scopeLimit = normalizeLimit(options.scopeLimit, DEFAULT_OBSERVABILITY_SCOPE_LIMIT);
  const roleLimit = normalizeLimit(options.roleLimit, DEFAULT_OBSERVABILITY_ROLE_LIMIT);

  // Gauge: number of currently-open operational subscriptions. Preserved
  // across flushes; never derived from an unbounded set of chatroom ids.
  let activeSubscriptions = 0;
  let intervalStartedAt = clock();
  let totals: IntervalTotals = zeroTotals();
  // Interval counters only: cleared on every successful flush.
  const scopes = new Map<string, ScopeBucketState>();
  // Chatrooms that own a dedicated bucket this interval; bounded to
  // scopeLimit entries. Any further chatroom aggregates into `__other__`
  // without being retained.
  const ownedScopes = new Set<string>();
  let dirty = false;

  function bucketFor(chatroomId: string): ScopeBucketState {
    let key = chatroomId;
    if (!ownedScopes.has(chatroomId)) {
      if (ownedScopes.size >= scopeLimit) {
        key = OTHER_BUCKET;
      } else {
        ownedScopes.add(chatroomId);
      }
    }
    let bucket = scopes.get(key);
    if (!bucket) {
      bucket = createScopeBucket();
      scopes.set(key, bucket);
    }
    return bucket;
  }

  function roleKeyFor(bucket: ScopeBucketState, role: string): string {
    if (bucket.roleCounts.has(role)) return role;
    if (bucket.distinctRoles >= roleLimit) return OTHER_BUCKET;
    return role;
  }

  function countRole(bucket: ScopeBucketState, role: string): void {
    const roleKey = roleKeyFor(bucket, role);
    const priorRoleCount = bucket.roleCounts.get(roleKey) ?? 0;
    if (priorRoleCount === 0 && roleKey !== OTHER_BUCKET) {
      bucket.distinctRoles += 1;
    }
    bucket.roleCounts.set(roleKey, priorRoleCount + 1);
  }

  function markDirty(): void {
    dirty = true;
  }

  function resetInterval(): void {
    totals = zeroTotals();
    scopes.clear();
    ownedScopes.clear();
    intervalStartedAt = clock();
    dirty = false;
  }

  function buildSnapshot(): OperationalObservabilitySnapshot {
    const timestamp = clock();
    const scopeSnapshots: OperationalObservabilityScopeSnapshot[] = [];
    for (const [chatroomId, bucket] of scopes) {
      const roleCounts: Record<string, number> = {};
      for (const [role, count] of bucket.roleCounts) {
        roleCounts[role] = count;
      }
      scopeSnapshots.push({
        chatroomId,
        pageCount: bucket.pageCount,
        signalCount: bucket.signalCount,
        hydrationCount: bucket.hydrationCount,
        hydratedRowCount: bucket.hydratedRowCount,
        removedRowCount: bucket.removedRowCount,
        acknowledgementCount: bucket.acknowledgementCount,
        errorCount: bucket.errorCount,
        restartCount: bucket.restartCount,
        roleCounts,
        ...(bucket.lastSignalAt === undefined ? {} : { lastSignalAt: bucket.lastSignalAt }),
      });
    }
    return {
      type: 'daemon.observability.operational-signals',
      schemaVersion: OPERATIONAL_OBSERVABILITY_SCHEMA_VERSION,
      machineId,
      timestamp,
      intervalStartedAt,
      activeSubscriptions,
      totals: { ...totals },
      scopes: scopeSnapshots,
    };
  }

  return {
    subscriptionStarted(_chatroomId: string): void {
      activeSubscriptions += 1;
      totals.subscriptionStarts += 1;
      markDirty();
    },
    subscriptionStopped(_chatroomId: string): void {
      activeSubscriptions = Math.max(0, activeSubscriptions - 1);
      totals.subscriptionStops += 1;
      markDirty();
    },
    signalPageReceived(
      chatroomId: string,
      signals: readonly { role: string; projectedAt: number }[]
    ): void {
      const bucket = bucketFor(chatroomId);
      bucket.pageCount += 1;
      totals.pageCount += 1;
      for (const signal of signals) {
        bucket.signalCount += 1;
        totals.signalCount += 1;
        countRole(bucket, signal.role);
        bucket.lastSignalAt =
          bucket.lastSignalAt === undefined
            ? signal.projectedAt
            : Math.max(bucket.lastSignalAt, signal.projectedAt);
      }
      markDirty();
    },
    hydrationCompleted(
      chatroomId: string,
      result: { rowCount: number; removedRowCount: number }
    ): void {
      const bucket = bucketFor(chatroomId);
      bucket.hydrationCount += 1;
      bucket.hydratedRowCount += result.rowCount;
      bucket.removedRowCount += result.removedRowCount;
      totals.hydrationCount += 1;
      totals.hydratedRowCount += result.rowCount;
      totals.removedRowCount += result.removedRowCount;
      markDirty();
    },
    acknowledgementAttempted(chatroomId: string): void {
      const bucket = bucketFor(chatroomId);
      bucket.acknowledgementCount += 1;
      totals.acknowledgementCount += 1;
      markDirty();
    },
    loopError(chatroomId: string): void {
      const bucket = bucketFor(chatroomId);
      bucket.errorCount += 1;
      totals.errorCount += 1;
      markDirty();
    },
    loopRestart(chatroomId: string): void {
      const bucket = bucketFor(chatroomId);
      bucket.restartCount += 1;
      totals.restartCount += 1;
      markDirty();
    },
    snapshot(): OperationalObservabilitySnapshot {
      return buildSnapshot();
    },
    async flush(): Promise<void> {
      if (!dirty) return;
      const snapshot = buildSnapshot();
      if (!sink) {
        resetInterval();
        return;
      }
      // Reset only after a successful sink call so a failed sink retries
      // the same evidence on the next flush instead of losing it.
      await sink(snapshot);
      resetInterval();
    },
  };
}
