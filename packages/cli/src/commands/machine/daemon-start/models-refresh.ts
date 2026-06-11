/**
 * Model Refresh — re-discovers harness models and pushes capability updates to
 * the backend when the set has changed. Extracted from command-loop.ts so the
 * Effect twin (refreshModelsEffect) has a cross-module production consumer.
 */

import { Effect } from 'effect';

import { harnessCapabilitiesFingerprint } from './capabilities-snapshot.js';
import { DaemonSessionService } from './daemon-services.js';
import { discoverModels } from './init.js';
import type { SessionId } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { ensureMachineRegistered } from '../../../infrastructure/machine/index.js';
import type { MachineConfig } from '../../../infrastructure/machine/types.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Outcome of a single `refreshModels` invocation (periodic tick or manual refresh). */
export type RefreshModelsOutcome =
  | { kind: 'noop' }
  | { kind: 'skipped_no_changes' }
  | { kind: 'pushed' }
  | { kind: 'failed'; message: string };

/**
 * Flat identity + ops required by refreshModelsCore.
 * DaemonSessionServiceShape structurally satisfies this type.
 */
type RefreshModelsDeps = {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
  agentServices: Map<string, RemoteAgentService>;
};

/**
 * Mutable state holder required by refreshModelsCore (passed by reference).
 * DaemonSessionServiceShape structurally satisfies this type, so the Effect
 * twin can pass `session` as both deps and stateHolder.
 */
type RefreshModelsStateHolder = {
  config: MachineConfig | null;
  lastPushedModels: Record<string, string[]> | null;
  lastPushedHarnessFingerprint: string | null;
};

/** Per-harness diff between two model snapshots. */
interface ModelDiff {
  /** Models present in `next` but not in `previous`, grouped by harness. */
  added: Record<string, string[]>;
  /** Models present in `previous` but not in `next`, grouped by harness. */
  removed: Record<string, string[]>;
  /** True when at least one harness has a non-empty added or removed list. */
  hasChanges: boolean;
}

/** Whether a per-harness model map has at least one harness entry. */
function hasEntries(map: Record<string, string[]>): boolean {
  return Object.keys(map).length > 0;
}

/** Set difference `a \ b` over model id lists, preserving the order of `a`. */
function difference(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  const exclude = new Set(b);
  return (a ?? []).filter((model) => !exclude.has(model));
}

/**
 * For every harness present in `from`, the models absent from the matching
 * harness in `against`, grouped by harness. Harnesses with no difference are
 * omitted, so the result contains only real changes. A harness that appears
 * solely in `from` is therefore reported in full.
 *
 * Comparison is set-based, so model order within a harness is irrelevant.
 */
function perHarnessDifference(
  from: Record<string, string[]>,
  against: Record<string, string[]>
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const harness of Object.keys(from)) {
    const models = difference(from[harness], against[harness]);
    if (models.length > 0) {
      result[harness] = models;
    }
  }
  return result;
}

/**
 * Compute the per-harness diff between the previously pushed model snapshot
 * and the freshly discovered set. A `null` previous snapshot is treated as
 * an empty record (everything is "added"), which forces an initial push.
 *
 * "Added" = present now but not previously; "removed" = present previously but
 * not now. A harness appearing in only one snapshot is fully attributed to the
 * corresponding side, so a brand-new harness shows up entirely under `added`.
 */
function diffModels(
  previous: Record<string, string[]> | null,
  next: Record<string, string[]>
): ModelDiff {
  const prev = previous ?? {};
  const added = perHarnessDifference(next, prev);
  const removed = perHarnessDifference(prev, next);
  return {
    added,
    removed,
    hasChanges: hasEntries(added) || hasEntries(removed),
  };
}

/**
 * Format a per-harness model map as a human-readable list for log output.
 * Returns e.g. `opencode: model-a, model-b; pi: model-c`.
 */
function formatModelMap(map: Record<string, string[]>): string {
  return Object.entries(map)
    .map(([harness, models]) => `${harness}: ${models.join(', ')}`)
    .join('; ');
}

/**
 * Whether the harness capability fingerprint differs from the last pushed one.
 * A `null` previous fingerprint (never pushed) is treated as "unchanged" so the
 * model diff alone decides the initial push.
 */
function harnessFingerprintChanged(previous: string | null, next: string): boolean {
  return previous !== null && previous !== next;
}

/**
 * Emit the human-readable model-refresh log lines after a successful push:
 * additions first, then removals, then the total-count summary. Called only on
 * success so transient failures do not re-print the same diff each tick.
 */
function logRefreshOutcome(diff: ModelDiff, totalCount: number): void {
  if (hasEntries(diff.added)) {
    console.log(`[${formatTimestamp()}] ➕ New models detected — ${formatModelMap(diff.added)}`);
  }
  if (hasEntries(diff.removed)) {
    console.log(
      `[${formatTimestamp()}] ➖ Models no longer available — ${formatModelMap(diff.removed)}`
    );
  }
  const summary = totalCount > 0 ? `${totalCount} models` : 'none discovered';
  console.log(`[${formatTimestamp()}] 🔄 Model refresh pushed: ${summary}`);
}

/**
 * Re-discover models and update the backend registration when the set has
 * changed since the last push.
 *
 * The daemon is the source of truth for "what changed since last sync" — the
 * previously pushed model snapshot lives on `stateHolder.lastPushedModels` and
 * is diffed locally each tick, and harness list + versions are compared via a
 * stable fingerprint. The mutation is only invoked when either snapshot differs.
 *
 * On a successful push, `stateHolder.lastPushedModels` and
 * `stateHolder.lastPushedHarnessFingerprint` are updated to the freshly
 * discovered state. On failure, both snapshots are left unchanged so the next
 * tick retries.
 */
async function refreshModelsCore(
  deps: RefreshModelsDeps,
  stateHolder: RefreshModelsStateHolder
): Promise<RefreshModelsOutcome> {
  if (!stateHolder.config) {
    return { kind: 'noop' };
  }
  // Capture non-null config before entering the Effect.gen closure so TypeScript
  // doesn't require repeated non-null assertions inside the lambda.
  const ctxConfig = stateHolder.config;

  return Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Effect.tryPromise({
        try: async () => discoverModels(deps.agentServices),
        catch: (e) => e,
      });

      // Re-detect available harnesses so any newly installed tools are reflected immediately.
      const freshConfig = yield* Effect.tryPromise({
        try: async () => ensureMachineRegistered(),
        catch: (e) => e,
      });
      ctxConfig.availableHarnesses = freshConfig.availableHarnesses;
      ctxConfig.harnessVersions = freshConfig.harnessVersions;

      const modelDiff = diffModels(stateHolder.lastPushedModels, models);
      const nextHarnessFingerprint = harnessCapabilitiesFingerprint(
        ctxConfig.availableHarnesses,
        ctxConfig.harnessVersions as Record<string, unknown>
      );
      const fingerprintChanged = harnessFingerprintChanged(
        stateHolder.lastPushedHarnessFingerprint,
        nextHarnessFingerprint
      );

      if (!modelDiff.hasChanges && !fingerprintChanged) {
        // Models and harness metadata match last successful push — skip Convex.
        return { kind: 'skipped_no_changes' } satisfies RefreshModelsOutcome;
      }

      const totalCount = Object.values(models).flat().length;

      yield* Effect.tryPromise({
        try: async () =>
          deps.backend.mutation(api.machines.refreshCapabilities, {
            sessionId: deps.sessionId,
            machineId: deps.machineId,
            availableHarnesses: ctxConfig.availableHarnesses,
            harnessVersions: ctxConfig.harnessVersions,
            availableModels: models,
          }),
        catch: (e) => e,
      });

      // Snapshot only after the backend successfully accepts the update — on
      // failure we want the next tick to retry with the same diff.
      stateHolder.lastPushedModels = models;
      stateHolder.lastPushedHarnessFingerprint = nextHarnessFingerprint;

      // Log only after a successful sync so transient failures do not re-print
      // the same diff every MODEL_REFRESH_INTERVAL_MS while retrying.
      logRefreshOutcome(modelDiff, totalCount);
      return { kind: 'pushed' } satisfies RefreshModelsOutcome;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          const message = getErrorMessage(error);
          console.warn(`[${formatTimestamp()}] ⚠️  Model refresh failed: ${message}`);
          return { kind: 'failed', message } satisfies RefreshModelsOutcome;
        })
      )
    )
  );
}

/** Effect twin for refreshModels — yields DaemonSessionService; DaemonSessionServiceShape satisfies both RefreshModelsDeps and RefreshModelsStateHolder. */
export const refreshModelsEffect: Effect.Effect<RefreshModelsOutcome, never, DaemonSessionService> =
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    return yield* Effect.promise(() => refreshModelsCore(session, session));
  });
