/**
 * Model Refresh — re-discovers harness models and pushes capability updates to
 * the backend when the set has changed.
 */

import { Effect, Ref } from 'effect';

import { harnessCapabilitiesFingerprint } from './capabilities-snapshot.js';
import { DaemonMutableStateService, DaemonSessionService } from './daemon-services.js';
import { discoverModelsEffect } from './init.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { ensureMachineRegistered } from '../../../infrastructure/machine/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Outcome of a single `refreshModels` invocation (periodic tick or manual refresh). */
export type RefreshModelsOutcome =
  | { kind: 'noop' }
  | { kind: 'skipped_no_changes' }
  | {
      kind: 'pushed';
      snapshot: {
        lastPushedModels: Record<string, string[]>;
        lastPushedHarnessFingerprint: string;
      };
    }
  | { kind: 'failed'; message: string };

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

/** Re-discover models and push capability updates when the set has changed. */
export const refreshModelsEffect: Effect.Effect<
  RefreshModelsOutcome,
  never,
  DaemonSessionService | DaemonMutableStateService
> = Effect.gen(function* () {
  const session = yield* DaemonSessionService;
  const mutable = yield* DaemonMutableStateService;

  if (!session.config) {
    return { kind: 'noop' } satisfies RefreshModelsOutcome;
  }
  const ctxConfig = session.config;

  const lastPushedModels = yield* Ref.get(mutable.lastPushedModels);
  const lastPushedHarnessFingerprint = yield* Ref.get(mutable.lastPushedHarnessFingerprint);

  const outcome = yield* Effect.gen(function* () {
    const models = yield* discoverModelsEffect(session.agentServices);

    const freshConfig = yield* Effect.tryPromise({
      try: async () => ensureMachineRegistered(),
      catch: (e) => e,
    });
    ctxConfig.availableHarnesses = freshConfig.availableHarnesses;
    ctxConfig.harnessVersions = freshConfig.harnessVersions;

    const modelDiff = diffModels(lastPushedModels, models);
    const nextHarnessFingerprint = harnessCapabilitiesFingerprint(
      ctxConfig.availableHarnesses,
      ctxConfig.harnessVersions as Record<string, unknown>
    );
    const fingerprintChanged = harnessFingerprintChanged(
      lastPushedHarnessFingerprint,
      nextHarnessFingerprint
    );

    if (!modelDiff.hasChanges && !fingerprintChanged) {
      return { kind: 'skipped_no_changes' } satisfies RefreshModelsOutcome;
    }

    const totalCount = Object.values(models).flat().length;

    yield* Effect.tryPromise({
      try: async () =>
        session.backend.mutation(api.machines.refreshCapabilities, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          availableHarnesses: ctxConfig.availableHarnesses,
          harnessVersions: ctxConfig.harnessVersions,
          availableModels: models,
        }),
      catch: (e) => e,
    });

    logRefreshOutcome(modelDiff, totalCount);
    return {
      kind: 'pushed',
      snapshot: {
        lastPushedModels: models,
        lastPushedHarnessFingerprint: nextHarnessFingerprint,
      },
    } satisfies RefreshModelsOutcome;
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        const message = getErrorMessage(error);
        console.warn(`[${formatTimestamp()}] ⚠️  Model refresh failed: ${message}`);
        return { kind: 'failed', message } satisfies RefreshModelsOutcome;
      })
    )
  );

  if (outcome.kind === 'pushed') {
    yield* Ref.set(mutable.lastPushedModels, outcome.snapshot.lastPushedModels);
    yield* Ref.set(
      mutable.lastPushedHarnessFingerprint,
      outcome.snapshot.lastPushedHarnessFingerprint
    );
  }

  return outcome;
});
