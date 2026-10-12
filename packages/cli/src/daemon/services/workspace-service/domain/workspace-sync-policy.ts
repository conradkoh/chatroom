import { OBSERVATION_TTL_MS } from '@workspace/backend/config/reliability.js';

import type { WorkspaceStateKind } from '../../../infrastructure/outbox/workspace-state-outbox.js';

/** Recursively optional view of `T`, used for policy overrides. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Tunables for the WorkspaceService sync loops. Constructed from `DEFAULT_WORKSPACE_SYNC_POLICY`
 * via `resolveWorkspaceSyncPolicy`. Deliberately has no env-var or config-file source.
 */
export type WorkspaceSyncPolicy = {
  probeIntervalMs: number;
  probeMaxBackoffMs: number;
  probeFailureThreshold: number;
  localSettleMs: number;
  localMaxWaitMs: number;
  dirtyStatCap: number;
  remote: {
    idleIntervalMs: number;
    hotIntervalMs: number;
    pendingChecksIntervalMs: number;
    hotWindowMs: number;
    minGapMs: number;
    triggerSettleMs: number;
    errorBackoffMaxMs: number;
  };
  observation: {
    ttlMs: number;
    graceMs: number;
    initialSkewAllowanceMs: number;
  };
  outbox: {
    minIntervalMsByKind: Record<WorkspaceStateKind, number>;
    retryDelayMs: number;
    maxRetryDelayMs: number;
    shutdownFlushTimeoutMs: number;
  };
};

export const DEFAULT_WORKSPACE_SYNC_POLICY: WorkspaceSyncPolicy = {
  probeIntervalMs: 3_000,
  probeMaxBackoffMs: 30_000,
  probeFailureThreshold: 3,
  localSettleMs: 400,
  localMaxWaitMs: 5_000,
  dirtyStatCap: 500,
  remote: {
    idleIntervalMs: 120_000,
    hotIntervalMs: 15_000,
    pendingChecksIntervalMs: 20_000,
    hotWindowMs: 180_000,
    minGapMs: 10_000,
    triggerSettleMs: 1_500,
    errorBackoffMaxMs: 600_000,
  },
  observation: {
    ttlMs: OBSERVATION_TTL_MS,
    graceMs: 15_000,
    initialSkewAllowanceMs: 60_000,
  },
  outbox: {
    minIntervalMsByKind: {
      head: 0,
      pullRequests: 0,
      upstream: 1_000,
      remotes: 1_000,
      checks: 2_000,
      recentCommits: 2_000,
      commands: 2_000,
      worktree: 3_000,
    },
    retryDelayMs: 1_000,
    maxRetryDelayMs: 300_000,
    shutdownFlushTimeoutMs: 2_000,
  },
};

/**
 * Deep-merges overrides onto the defaults. Used by tests to shorten individual intervals.
 * Never mutates `DEFAULT_WORKSPACE_SYNC_POLICY`; always returns a fresh object tree.
 * Constraint: the policy contains only plain objects and numbers, so arrays are not merged.
 */
// Reason: no public path. Production passes DEFAULT_WORKSPACE_SYNC_POLICY and has no override
// source by design; only the service, monitor and integration tests build partial overrides.
// fallow-ignore-next-line unused-export
export function resolveWorkspaceSyncPolicy(
  overrides?: DeepPartial<WorkspaceSyncPolicy>
): WorkspaceSyncPolicy {
  return mergeDeep(DEFAULT_WORKSPACE_SYNC_POLICY, overrides) as WorkspaceSyncPolicy;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks the base shape and copies each leaf from the override when present, otherwise from the base. */
function mergeDeep(base: unknown, override: unknown): unknown {
  const source = override === undefined ? base : override;
  if (!isPlainObject(base) || !isPlainObject(source)) return source;
  return mergeObject(base, source);
}

function mergeObject(base: Record<string, unknown>, source: Record<string, unknown>): object {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    result[key] = mergeDeep(base[key], source[key]);
  }
  return result;
}
