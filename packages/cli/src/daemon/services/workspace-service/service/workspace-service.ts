import { createRemotePollQueue, type RemotePollQueue } from './remote-poll-queue.js';
import { createWorkspaceMonitor, type WorkspaceMonitor } from './workspace-monitor.js';
import { normalizeWorkingDirForLookup } from '../../../../infrastructure/services/workspace/normalize-working-dir.js';
import {
  createObservationTracker,
  type ObservationTier,
  type ObservationTracker,
  type WorkspaceActivityRow,
} from '../domain/observation-tier.js';
import type { LocalKind, WorkspaceStateUnit } from '../domain/workspace-state-unit.js';
import {
  DEFAULT_WORKSPACE_SYNC_POLICY,
  type WorkspaceSyncPolicy,
} from '../domain/workspace-sync-policy.js';
import {
  collectLocalUnits,
  type LocalCollectResult,
} from '../infrastructure/local-unit-collector.js';
import {
  collectRemoteUnits,
  type RemoteCollectResult,
} from '../infrastructure/remote-unit-collector.js';
import type { WorkspaceActivitySource } from '../infrastructure/workspace-activity-source.js';
import {
  createWorkspaceGitProbe,
  type WorkspaceGitProbe,
} from '../infrastructure/workspace-git-probe.js';

/** The part of the workspace-state outbox this service drives. Keys are per working directory. */
export type WorkspaceServiceOutbox = {
  enqueue(workingDir: string, unit: WorkspaceStateUnit): void;
  /** Drops every pending delivery for `workingDir`. Called once when the workspace leaves membership. */
  stopKeys(workingDir: string): void;
};

type OptionalDeps = Omit<WorkspaceServiceDeps, 'activitySource' | 'outbox'>;

export type WorkspaceServiceDeps = {
  activitySource: WorkspaceActivitySource;
  outbox: WorkspaceServiceOutbox;
  /** Default `DEFAULT_WORKSPACE_SYNC_POLICY`. Use `resolveWorkspaceSyncPolicy` for partial overrides. */
  policy?: WorkspaceSyncPolicy;
  /** Default `Date.now`. */
  now?: () => number;
  /** Default: a `createWorkspaceGitProbe` for the directory. */
  createProbe?: (workingDir: string) => WorkspaceGitProbe;
  /** Default `collectLocalUnits`. */
  collectLocal?: (workingDir: string, kinds: ReadonlySet<LocalKind>) => Promise<LocalCollectResult>;
  /** Default `collectRemoteUnits`. */
  collectRemote?: (workingDir: string, branch: string) => Promise<RemoteCollectResult>;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

/** Why a caller asked for a refresh. Logged with the refresh; it does not change what runs. */
export type WorkspaceRefreshReason = 'command' | 'local-action' | 'pr-action';

export type WorkspaceService = {
  /** Subscribes to the activity source. Idempotent. No-op after `stopAll`. */
  start(): void;
  /**
   * Clears the monitor's hashes, recomputes every local unit, and schedules a remote poll.
   * No-op for a directory that is not registered. Never creates a monitor.
   */
  refresh(workingDir: string, reason: WorkspaceRefreshReason): Promise<void>;
  /** True while the directory is a member, which means it has a live monitor. */
  isRegistered(workingDir: string): boolean;
  /** Unsubscribes, stops every monitor, and resolves when all in-flight work has settled. */
  stopAll(): Promise<void>;
};

type TimerHandle = ReturnType<typeof setTimeout>;

/** Every optional dependency, with its default applied. */
type ResolvedDeps = {
  [K in keyof OptionalDeps]-?: NonNullable<OptionalDeps[K]>;
};

type MonitorEntry = {
  monitor: WorkspaceMonitor;
  /** The tier last passed to `monitor.setTier`. Only a change is forwarded. */
  tier: ObservationTier;
  /** Stops this entry's callbacks from reaching the outbox and the remote queue. */
  retire(): void;
};

type ServiceState = {
  deps: ResolvedDeps;
  outbox: WorkspaceServiceOutbox;
  tracker: ObservationTracker;
  monitors: Map<string, MonitorEntry>;
  /** Removals whose monitor is still winding down. `stopAll` waits for them. */
  pendingStops: Set<Promise<void>>;
  queue: RemotePollQueue;
  transitionTimer: TimerHandle | null;
  stopped: boolean;
};

/**
 * Owns workspace membership for the machine. Each active workingDir has exactly one monitor.
 *
 * Constraints:
 * - Membership changes are synchronous. A removed directory leaves the map before any await, so
 *   `isRegistered` is false at once and a re-added directory never shares state with the old one.
 * - A retired monitor cannot enqueue or schedule. Its late callbacks are dropped, so a removed
 *   workspace produces no outbox writes after `stopKeys`.
 * - One global remote queue serializes remote polls. Each workspace's timer is separate, so
 *   scheduling one workspace never delays another.
 * - Tier decay is driven by the tracker's `nextTransitionAt`, so an observed workspace goes idle
 *   on time with no new activity snapshot.
 * - Intervals come only from `policy`. No `Date.now()` is read here. Clock is `now`.
 */
export function createWorkspaceService(deps: WorkspaceServiceDeps): WorkspaceService {
  const state = createServiceState(deps);
  let unsubscribe: (() => void) | null = null;

  return {
    start() {
      if (state.stopped || unsubscribe !== null) return;
      unsubscribe = deps.activitySource.subscribe((rows) => applySnapshot(state, rows));
    },

    async refresh(workingDir, reason) {
      console.log(`[workspace-service] refresh ${workingDir} (reason: ${reason})`);
      const entry = state.monitors.get(normalizeWorkingDirForLookup(workingDir));
      if (entry) await entry.monitor.refresh();
    },

    isRegistered(workingDir) {
      return state.monitors.has(normalizeWorkingDirForLookup(workingDir));
    },

    async stopAll() {
      unsubscribe?.();
      unsubscribe = null;
      await stopAllMembers(state);
    },
  };
}

/** Fills every optional dependency with its production default. */
function resolveDeps(deps: WorkspaceServiceDeps): ResolvedDeps {
  const policy = deps.policy ?? DEFAULT_WORKSPACE_SYNC_POLICY;
  const now = deps.now ?? Date.now;
  return {
    policy,
    now,
    createProbe: deps.createProbe ?? defaultProbeFactory(policy, now),
    ...resolveCollectors(deps),
    ...resolveTimers(deps),
  };
}

/**
 * The default probe reads `git status` for each workspace. `rootPathspec` is empty: a workspace
 * nested in a larger repo is probed against the whole repo. That can only add local recomputes,
 * and unit-hash dedup keeps emissions correct.
 */
function defaultProbeFactory(
  policy: WorkspaceSyncPolicy,
  now: () => number
): (workingDir: string) => WorkspaceGitProbe {
  return (workingDir) =>
    createWorkspaceGitProbe({
      workTree: workingDir,
      rootPathspec: [],
      dirtyStatCap: policy.dirtyStatCap,
      now,
    });
}

function resolveCollectors(
  deps: WorkspaceServiceDeps
): Pick<ResolvedDeps, 'collectLocal' | 'collectRemote'> {
  return {
    collectLocal: deps.collectLocal ?? collectLocalUnits,
    collectRemote: deps.collectRemote ?? collectRemoteUnits,
  };
}

function resolveTimers(deps: WorkspaceServiceDeps): Pick<ResolvedDeps, 'setTimer' | 'clearTimer'> {
  return {
    setTimer: deps.setTimer ?? setTimeout,
    clearTimer: deps.clearTimer ?? clearTimeout,
  };
}

function createServiceState(deps: WorkspaceServiceDeps): ServiceState {
  const resolved = resolveDeps(deps);
  const monitors = new Map<string, MonitorEntry>();
  const queue = createRemotePollQueue({
    minGapMs: resolved.policy.remote.minGapMs,
    now: resolved.now,
    run: (workingDir) => monitors.get(workingDir)?.monitor.runRemotePoll() ?? Promise.resolve(),
    setTimer: (fn, ms) => resolved.setTimer(fn, ms),
    clearTimer: (handle) => resolved.clearTimer(handle as TimerHandle),
  });
  return {
    deps: resolved,
    outbox: deps.outbox,
    tracker: createObservationTracker(resolved.policy.observation, resolved.now),
    monitors,
    pendingStops: new Set(),
    queue,
    transitionTimer: null,
    stopped: false,
  };
}

/** Builds the monitor for `workingDir`. Its callbacks stop reaching the outbox once it is retired. */
function createEntry(state: ServiceState, workingDir: string): MonitorEntry {
  const { deps, outbox, queue } = state;
  let live = true;
  const monitor = createWorkspaceMonitor({
    workingDir,
    policy: deps.policy,
    now: deps.now,
    probe: deps.createProbe(workingDir),
    collectLocal: deps.collectLocal,
    collectRemote: deps.collectRemote,
    enqueue: (unit) => {
      if (live) outbox.enqueue(workingDir, unit);
    },
    scheduleRemote: (delayMs) => {
      if (live) queue.schedule(workingDir, delayMs);
    },
    cancelRemote: () => {
      if (live) queue.cancel(workingDir);
    },
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
  });
  return {
    monitor,
    tier: 'idle',
    retire: () => {
      live = false;
    },
  };
}

/** Synchronously removes `workingDir`, then stops its monitor in the background. */
function removeMember(state: ServiceState, workingDir: string): void {
  const entry = state.monitors.get(workingDir);
  if (!entry) return;
  state.monitors.delete(workingDir);
  entry.retire();
  state.queue.cancel(workingDir);
  state.outbox.stopKeys(workingDir);
  trackStop(state, entry.monitor.stop());
}

function trackStop(state: ServiceState, stopping: Promise<void>): void {
  state.pendingStops.add(stopping);
  const settle = (): void => {
    state.pendingStops.delete(stopping);
  };
  void stopping.then(settle, settle);
}

/** Forwards each monitor's tier when it differs from the last one forwarded. */
function reconcileTiers(state: ServiceState): void {
  for (const [workingDir, entry] of state.monitors) {
    const tier = state.tracker.tierOf(workingDir);
    if (tier === entry.tier) continue;
    entry.tier = tier;
    entry.monitor.setTier(tier);
  }
}

function cancelTransition(state: ServiceState): void {
  if (state.transitionTimer === null) return;
  state.deps.clearTimer(state.transitionTimer);
  state.transitionTimer = null;
}

/** Arms one timer for the next observed-to-idle decay, or none when no key is observed. */
function armTransition(state: ServiceState): void {
  cancelTransition(state);
  if (state.stopped) return;
  const at = state.tracker.nextTransitionAt();
  if (at === null) return;
  state.transitionTimer = state.deps.setTimer(() => onTransitionDue(state), at - state.deps.now());
}

function onTransitionDue(state: ServiceState): void {
  state.transitionTimer = null;
  reconcileTiers(state);
  armTransition(state);
}

function applySnapshot(state: ServiceState, rows: readonly WorkspaceActivityRow[]): void {
  if (state.stopped) return;
  const { added, removed } = state.tracker.apply(rows);
  for (const workingDir of removed) removeMember(state, workingDir);
  for (const workingDir of added) state.monitors.set(workingDir, createEntry(state, workingDir));
  reconcileTiers(state);
  armTransition(state);
}

async function stopAllMembers(state: ServiceState): Promise<void> {
  state.stopped = true;
  cancelTransition(state);
  const entries = [...state.monitors.values()];
  state.monitors.clear();
  for (const entry of entries) entry.retire();
  await Promise.all([
    ...entries.map((entry) => entry.monitor.stop()),
    ...state.pendingStops,
    state.queue.stopAll(),
  ]);
}
