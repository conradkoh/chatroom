/**
 * Model Refresh — re-discovers harness models and pushes capability updates to
 * the backend when the set has changed.
 */

import type { CatalogBackedHarness } from '@workspace/backend/src/domain/entities/harness/model-catalog.js';
import type { ConvexHttpClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { Effect, Ref } from 'effect';

import { harnessCapabilitiesFingerprint } from './capabilities-snapshot.js';
import { DaemonMutableStateService, DaemonSessionService } from './daemon-services.js';
import { formatTimestamp } from './daemon-utils.js';
import { discoverModels, discoverModelsForHarness } from './init-daemon.js';
import { api } from '../../api.js';
import { ensureMachineRegistered } from '../../infrastructure/machine/index.js';
import type { MachineConfig } from '../../infrastructure/machine/types.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import type { RemoteAgentService } from '../infrastructure/local/harness/services/remote-agent-service.js';

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

// ─── Server model catalog ────────────────────────────────────────────────────

/**
 * Catalog-backed harnesses and their `api.harnesses.<harness>.listModels`
 * endpoints. The server catalog is the source of truth for these harnesses'
 * model lists — the daemon never embeds the lists themselves.
 *
 * Resolved lazily: `api` may be partially mocked in tests, and accessing a
 * missing module at import time would crash the daemon entry module.
 */
/** A `listModels` catalog endpoint as invoked by the daemon (plain-string session id). */
type CatalogListModelsQuery = FunctionReference<'query', 'public', { sessionId: string }, string[]>;

/**
 * Catalog-backed harnesses and their `api.harnesses.<harness>.listModels`
 * endpoints. The server catalog is the source of truth for these harnesses'
 * model lists — the daemon never embeds the lists themselves.
 *
 * Resolved lazily: `api` may be partially mocked in tests, and accessing a
 * missing module at import time would crash the daemon entry module. The
 * generated refs carry convex-helpers' branded session args; the daemon passes
 * plain strings (server validators are `v.string()`), so the refs are narrowed
 * to the daemon's calling convention here.
 */
function getCatalogEndpoints(): Record<
  CatalogBackedHarness,
  { listModels: CatalogListModelsQuery } | undefined
> {
  const harnesses = api.harnesses;
  return {
    'codex-sdk': harnesses?.codexSdk,
    copilot: harnesses?.copilot,
    cursor: harnesses?.cursor,
    'cursor-sdk': harnesses?.cursorSdk,
    claude: harnesses?.claude,
    'claude-sdk': harnesses?.claudeSdk,
  } as unknown as Record<CatalogBackedHarness, { listModels: CatalogListModelsQuery } | undefined>;
}

/**
 * Fetch the server model catalog — one query per catalog-backed harness, run
 * concurrently. A failed query skips that harness so a backend hiccup never
 * blocks discovery; the harness then keeps its local (stub) result.
 */
// fallow-ignore-next-line unused-export
export async function fetchHarnessCatalog(
  client: Pick<ConvexHttpClient, 'query'>,
  sessionId: string
): Promise<Record<string, string[]>> {
  const endpoints = getCatalogEndpoints();
  const entries = await Promise.all(
    (Object.keys(endpoints) as CatalogBackedHarness[]).map(async (harness) => {
      const endpoint = endpoints[harness]?.listModels;
      // Missing endpoint (partially mocked api) — same catch-and-skip as query failures.
      if (!endpoint) return undefined;
      try {
        return [harness, await client.query(endpoint, { sessionId })] as const;
      } catch (error) {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Server model catalog fetch failed for ${harness}: ${getErrorMessage(error)}`
        );
        return undefined;
      }
    })
  );
  return Object.fromEntries(
    entries.filter((entry): entry is [CatalogBackedHarness, string[]] => entry !== undefined)
  );
}

/**
 * Overlay the server catalog onto locally discovered models: for catalog-backed
 * harnesses the server list (which can grow new variants without a CLI release)
 * replaces the local result (empty stub / previously hard-coded list).
 */
// fallow-ignore-next-line unused-export
export function applyCatalogOverlay(
  discovered: Record<string, string[]>,
  catalog: Record<string, string[]>
): Record<string, string[]> {
  for (const [harness, models] of Object.entries(catalog)) {
    discovered[harness] = models;
  }
  return discovered;
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

type PushModelsSnapshotOutcome =
  | { kind: 'skipped_no_changes' }
  | {
      kind: 'pushed';
      snapshot: {
        lastPushedModels: Record<string, string[]>;
        lastPushedHarnessFingerprint: string;
      };
    }
  | { kind: 'failed'; message: string };

function logPushOutcome(
  modelDiff: ModelDiff,
  totalCount: number,
  options?: { logPrefix?: string }
): void {
  if (options?.logPrefix) {
    console.log(
      `[${formatTimestamp()}] 🔄 ${options.logPrefix}: ${totalCount > 0 ? `${totalCount} models` : 'none discovered'}`
    );
    return;
  }
  logRefreshOutcome(modelDiff, totalCount);
}

const pushModelsSnapshotMutationEffect = (
  models: Record<string, string[]>,
  modelDiff: ModelDiff,
  nextHarnessFingerprint: string,
  ctxConfig: MachineConfig,
  options?: { logPrefix?: string }
): Effect.Effect<
  Extract<PushModelsSnapshotOutcome, { kind: 'pushed' }>,
  unknown,
  DaemonSessionService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

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

    const totalCount = Object.values(models).flat().length;
    logPushOutcome(modelDiff, totalCount, options);

    return {
      kind: 'pushed',
      snapshot: {
        lastPushedModels: models,
        lastPushedHarnessFingerprint: nextHarnessFingerprint,
      },
    };
  });

/** Push a model snapshot when it differs from the last pushed state. */
const pushModelsSnapshotIfChangedEffect = (
  models: Record<string, string[]>,
  options?: { logPrefix?: string }
): Effect.Effect<
  PushModelsSnapshotOutcome,
  never,
  DaemonSessionService | DaemonMutableStateService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const mutable = yield* DaemonMutableStateService;

    if (!session.config) {
      return { kind: 'skipped_no_changes' } satisfies PushModelsSnapshotOutcome;
    }

    const lastPushedModels = yield* Ref.get(mutable.lastPushedModels);
    const lastPushedHarnessFingerprint = yield* Ref.get(mutable.lastPushedHarnessFingerprint);
    const modelDiff = diffModels(lastPushedModels, models);
    const nextHarnessFingerprint = harnessCapabilitiesFingerprint(
      session.config.availableHarnesses,
      session.config.harnessVersions as Record<string, unknown>
    );

    if (
      !modelDiff.hasChanges &&
      !harnessFingerprintChanged(lastPushedHarnessFingerprint, nextHarnessFingerprint)
    ) {
      return { kind: 'skipped_no_changes' } satisfies PushModelsSnapshotOutcome;
    }

    return yield* pushModelsSnapshotMutationEffect(
      models,
      modelDiff,
      nextHarnessFingerprint,
      session.config,
      options
    );
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        const message = getErrorMessage(error);
        console.warn(`[${formatTimestamp()}] ⚠️  Model refresh failed: ${message}`);
        return { kind: 'failed', message } satisfies PushModelsSnapshotOutcome;
      })
    )
  );

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

  const outcome = yield* Effect.gen(function* () {
    const catalog = yield* Effect.promise(() =>
      fetchHarnessCatalog(session.client, session.sessionId)
    );
    const models = yield* Effect.tryPromise({
      try: async () => discoverModels(session.agentServices),
      catch: (e) => e,
    });
    applyCatalogOverlay(models, catalog);

    const freshConfig = yield* Effect.tryPromise({
      try: async () => ensureMachineRegistered(),
      catch: (e) => e,
    });
    ctxConfig.availableHarnesses = freshConfig.availableHarnesses;
    ctxConfig.harnessVersions = freshConfig.harnessVersions;

    return yield* pushModelsSnapshotIfChangedEffect(models);
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
    return {
      kind: 'pushed',
      snapshot: outcome.snapshot,
    } satisfies RefreshModelsOutcome;
  }

  if (outcome.kind === 'skipped_no_changes') {
    return { kind: 'skipped_no_changes' } satisfies RefreshModelsOutcome;
  }

  return outcome satisfies RefreshModelsOutcome;
});

/**
 * Merge one harness's discovery result into the previous snapshot, applying
 * the server catalog overlay for catalog-backed harnesses.
 */
function nextSnapshotAfterHarness(
  current: Record<string, string[]> | null,
  harness: string,
  result: { installed: boolean; models: string[] },
  catalog: Record<string, string[]>
): Record<string, string[]> {
  const next = { ...(current ?? {}) };
  if (result.installed) {
    next[harness] = catalog[harness] ?? result.models;
  } else {
    delete next[harness];
  }
  return next;
}

const discoverAndPushHarnessModelsEffect = (
  harness: string,
  service: RemoteAgentService,
  catalog: Record<string, string[]>
): Effect.Effect<void, never, DaemonSessionService | DaemonMutableStateService> =>
  Effect.gen(function* () {
    const mutable = yield* DaemonMutableStateService;
    const result = yield* Effect.promise(() => discoverModelsForHarness(harness, service));

    const next = nextSnapshotAfterHarness(
      yield* Ref.get(mutable.lastPushedModels),
      harness,
      result,
      catalog
    );

    const pushOutcome = yield* pushModelsSnapshotIfChangedEffect(next, {
      logPrefix: `${harness} models updated`,
    });

    if (pushOutcome.kind === 'pushed') {
      yield* Ref.set(mutable.lastPushedModels, pushOutcome.snapshot.lastPushedModels);
      yield* Ref.set(
        mutable.lastPushedHarnessFingerprint,
        pushOutcome.snapshot.lastPushedHarnessFingerprint
      );
    }
  });

/**
 * Discover models for each harness in parallel and push updates independently
 * as each harness completes. Preserves cached models for harnesses that have not
 * finished discovery yet.
 */
export const startBackgroundModelDiscoveryEffect: Effect.Effect<
  void,
  never,
  DaemonSessionService | DaemonMutableStateService
> = Effect.gen(function* () {
  const session = yield* DaemonSessionService;

  if (!session.config) return;

  const catalog = yield* Effect.promise(() =>
    fetchHarnessCatalog(session.client, session.sessionId)
  );

  yield* Effect.forEach(
    Array.from(session.agentServices.entries()),
    ([harness, service]) => discoverAndPushHarnessModelsEffect(harness, service, catalog),
    { concurrency: 'unbounded' }
  );
});
