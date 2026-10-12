import {
  createLocalRecomputeScheduler,
  type LocalRecomputeScheduler,
} from './local-recompute-scheduler.js';
import { isRemoteResultCurrent, nextRemotePollDelayMs } from './remote-cadence.js';
import { computeBackoff } from '../../../../infrastructure/services/workspace/git-workspace-change-source.js';
import type { WorkspaceActivity } from '../domain/workspace-activity.js';
import {
  hashUnit,
  LOCAL_KINDS,
  type LocalKind,
  type WorkspaceStateKind,
  type WorkspaceStateUnit,
} from '../domain/workspace-state-unit.js';
import type { WorkspaceSyncPolicy } from '../domain/workspace-sync-policy.js';
import type { LocalCollectResult } from '../infrastructure/local-unit-collector.js';
import type { RemoteCollectResult } from '../infrastructure/remote-unit-collector.js';
import {
  diffProbeSnapshots,
  type ProbeSnapshot,
  type WorkspaceGitProbe,
} from '../infrastructure/workspace-git-probe.js';

export type WorkspaceMonitorDeps = {
  workingDir: string;
  policy: WorkspaceSyncPolicy;
  now: () => number;
  probe: WorkspaceGitProbe;
  /** Bind to `collectLocalUnits`. */
  collectLocal: (workingDir: string, kinds: ReadonlySet<LocalKind>) => Promise<LocalCollectResult>;
  /** Bind to `collectRemoteUnits`. */
  collectRemote: (workingDir: string, branch: string) => Promise<RemoteCollectResult>;
  /** Called only when a unit's hash changed since this monitor last emitted that kind. */
  enqueue: (unit: WorkspaceStateUnit) => void;
  /** Schedules this workspace's remote poll on the shared serial queue. */
  scheduleRemote: (delayMs: number) => void;
  /** Cancels this workspace's pending remote poll. An in-flight poll is not cancelled. */
  cancelRemote: () => void;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

export type WorkspaceMonitor = {
  /**
   * Idempotent: a value equal to the current one is ignored. `active`: runs a full local recompute,
   * starts the probe loop if the last full recompute saw a git repo, and schedules an immediate
   * remote poll. `idle`: stops the probe loop, cancels pending local and remote work, runs one final
   * local recompute, and schedules one remote poll that does not reschedule. Hashes are kept, and
   * the monitor stays alive.
   */
  setActivity(activity: WorkspaceActivity): void;
  /** Clears all unit hashes, recomputes every local unit, and schedules an immediate remote poll. Resolves when the local recompute has finished. Works in any activity. */
  refresh(): Promise<void>;
  /** Invoked by the remote queue. Resolves when the poll is applied, discarded, or failed. */
  runRemotePoll(): Promise<void>;
  /** Stops all timers and resolves when the serial chain is idle. Later calls are no-ops. */
  stop(): Promise<void>;
};

type TimerHandle = ReturnType<typeof setTimeout>;

/** The armed probe timer. A fresh object per arm, so a stale timer callback can tell it was superseded. */
type ProbeLoop = { timer: TimerHandle };

/** The branch and HEAD a remote poll runs for. */
type PollTarget = { branch: string; oid: string };

type RemoteOk = Extract<RemoteCollectResult, { ok: true }>;

/**
 * Per-workingDir monitor: turns probe reads, local recomputes, and remote polls into unit emissions.
 *
 * Constraints:
 * - Every state transition runs on one serial promise chain (invariant I6). Errors are logged and
 *   never break the chain.
 * - Hash dedup lives here: a unit is enqueued only when its hash differs from the last one this
 *   monitor emitted for its kind. `refresh` clears the hashes.
 * - The probe loop runs only while `active`. The monitor is the only probe consumer.
 * - Remote polls reschedule only while `active`. A poll that was already queued runs once in `idle`.
 * - Activity is set by the service from agent presence. The monitor does not decide it.
 * - All I/O arrives through `deps`, so the monitor needs no git, gh, Convex, or outbox at test time.
 */
export function createWorkspaceMonitor(deps: WorkspaceMonitorDeps): WorkspaceMonitor {
  const { workingDir, policy, probe, now } = deps;
  const setTimer: (fn: () => void, ms: number) => TimerHandle = deps.setTimer ?? setTimeout;
  const clearTimer: (handle: TimerHandle) => void = deps.clearTimer ?? clearTimeout;

  let activity: WorkspaceActivity = 'idle';
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();

  const lastHash = new Map<WorkspaceStateKind, string>();
  /** Set by each completed local recompute. Null until the first one completes. */
  let gitAvailable: boolean | null = null;
  let lastHasRemote = false;
  let lastSnapshot: ProbeSnapshot | null = null;
  let lastTriggerAt: number | null = null;
  let checksState: string | null = null;
  let consecutiveFailures = 0;
  let probeFailures = 0;
  let activeProbe: ProbeLoop | null = null;

  const localScheduler: LocalRecomputeScheduler = createLocalRecomputeScheduler({
    settleMs: policy.localSettleMs,
    maxWaitMs: policy.localMaxWaitMs,
    run: (kinds) => void serial(() => localRecompute(kinds)),
    now,
    setTimer,
    clearTimer,
  });

  function logError(err: unknown): void {
    console.error(`[workspace-monitor] ${workingDir}:`, err);
  }

  /** Appends `fn` to the serial chain. Skipped once stopped; a thrown error is logged, not rethrown. */
  function serial(fn: () => Promise<void> | void): Promise<void> {
    chain = chain
      .then(async () => {
        if (!stopped) await fn();
      })
      .catch(logError);
    return chain;
  }

  /** True while the monitor is active and not shutting down. Gates every reschedule. */
  function isActive(): boolean {
    return activity === 'active' && !stopped;
  }

  function emit(unit: WorkspaceStateUnit): void {
    const hash = hashUnit(unit);
    if (lastHash.get(unit.kind) === hash) return;
    lastHash.set(unit.kind, hash);
    deps.enqueue(unit);
  }

  function applyLocalResult(result: LocalCollectResult): void {
    gitAvailable = result.headAvailable;
    lastHasRemote = result.hasRemote;
    for (const unit of result.units) emit(unit);
  }

  async function localRecompute(kinds: ReadonlySet<LocalKind>): Promise<void> {
    applyLocalResult(await deps.collectLocal(workingDir, kinds));
  }

  // ---- Probe loop (active only) ----

  function armProbe(delayMs: number): void {
    const loop: ProbeLoop = {
      timer: setTimer(() => void serial(() => runProbeTick(loop)), delayMs),
    };
    activeProbe = loop;
  }

  function startProbeLoop(): void {
    if (activeProbe !== null || stopped) return;
    armProbe(policy.probeIntervalMs);
  }

  function stopProbeLoop(): void {
    if (activeProbe === null) return;
    clearTimer(activeProbe.timer);
    activeProbe = null;
  }

  /** Reads the probe, or returns null when the read fails. The failure is logged here. */
  async function readProbeOrNull(): Promise<ProbeSnapshot | null> {
    try {
      return await probe.readSnapshot({ maxAgeMs: 0 });
    } catch (err) {
      logError(err);
      return null;
    }
  }

  async function runProbeTick(loop: ProbeLoop): Promise<void> {
    if (activeProbe !== loop) return;
    const snap = await readProbeOrNull();
    if (activeProbe !== loop) return;
    if (snap === null) {
      onProbeFailure();
      return;
    }
    probeFailures = 0;
    applyProbeSnapshot(snap);
    armProbe(policy.probeIntervalMs);
  }

  function onProbeFailure(): void {
    probeFailures++;
    // At the threshold, re-read HEAD once so the head unit reflects a repo that has become unreadable.
    if (probeFailures === policy.probeFailureThreshold) localScheduler.requestNow(['head']);
    armProbe(computeBackoff(probeFailures, policy.probeIntervalMs, policy.probeMaxBackoffMs));
  }

  function applyProbeSnapshot(snap: ProbeSnapshot): void {
    const isBaseline = lastSnapshot === null;
    const { localKinds, remoteTrigger } = diffProbeSnapshots(lastSnapshot, snap);
    lastSnapshot = snap;
    // The first snapshot after activation is a baseline. tierUp already scheduled the remote poll,
    // so the baseline must not schedule a second one.
    if (remoteTrigger && !isBaseline) {
      lastTriggerAt = now();
      deps.scheduleRemote(policy.remote.triggerSettleMs);
    }
    if (localKinds.size > 0) localScheduler.request(localKinds);
  }

  // ---- Remote polls ----

  function rescheduleRemote(): void {
    if (!isActive()) return;
    deps.scheduleRemote(
      nextRemotePollDelayMs({
        now: now(),
        lastTriggerAt,
        checksState,
        consecutiveFailures,
        policy: policy.remote,
      })
    );
  }

  /** Publishes the empty remote units for a workspace that cannot be polled. */
  function publishIneligible(): void {
    emit({ kind: 'pullRequests', openPullRequests: [] });
    emit({ kind: 'checks', headCommitStatus: null });
    checksState = null;
  }

  /** The branch and oid to poll, or null when HEAD is not on a named branch. */
  function pollTarget(snap: ProbeSnapshot): PollTarget | null {
    const { oid, head } = snap.branch;
    if (oid === null || head === null || head === 'HEAD') return null;
    return { branch: head, oid };
  }

  /** The branch and oid of a snapshot, with missing values as ''. Compared against a poll target. */
  function refOf(snap: ProbeSnapshot): PollTarget {
    return { branch: snap.branch.head ?? '', oid: snap.branch.oid ?? '' };
  }

  function onRemoteFailure(): void {
    consecutiveFailures++;
    rescheduleRemote();
  }

  function applyRemoteResult(result: RemoteOk): void {
    consecutiveFailures = 0;
    checksState = result.checksState;
    for (const unit of result.units) emit(unit);
    rescheduleRemote();
  }

  /**
   * Applies a successful poll only when the branch and HEAD are unchanged since the poll started.
   * Otherwise the result is dropped and the poll runs again at once.
   */
  async function applyIfCurrent(target: PollTarget, result: RemoteOk): Promise<void> {
    const current = refOf(await probe.readSnapshot({ maxAgeMs: 0 }));
    if (!isRemoteResultCurrent(target, current)) {
      // A stale result reruns the poll at once, but only while active. An idle monitor does not reschedule.
      if (isActive()) deps.scheduleRemote(0);
      return;
    }
    applyRemoteResult(result);
  }

  async function pollRemote(): Promise<void> {
    // No remote means no poll. Checked before the probe read, which fails outside a git repo.
    if (!lastHasRemote) {
      publishIneligible();
      return;
    }
    const target = pollTarget(await probe.readSnapshot({ maxAgeMs: 0 }));
    if (target === null) {
      publishIneligible();
      return;
    }
    const result = await deps.collectRemote(workingDir, target.branch);
    if (!result.ok) {
      onRemoteFailure();
      return;
    }
    await applyIfCurrent(target, result);
  }

  // ---- Public API ----

  /**
   * Runs the full recompute, then arms the probe and the remote poll. The arm steps run in
   * `finally`, so a failed local recompute still arms them. The probe is skipped only when the
   * last completed recompute reported no git repo.
   */
  async function tierUp(): Promise<void> {
    if (!isActive()) return;
    try {
      await localRecompute(new Set(LOCAL_KINDS));
    } finally {
      if (isActive()) {
        if (gitAvailable !== false) startProbeLoop();
        lastTriggerAt = now();
        deps.scheduleRemote(0);
      }
    }
  }

  /**
   * The last sync before idle. Runs on the serial chain after the synchronous stop steps in
   * `setActivity`. It is skipped when the monitor became active again before it ran, because the
   * queued `tierUp` covers that. Its remote poll does not reschedule, because `isActive` is false.
   */
  async function finalFlush(): Promise<void> {
    if (activity !== 'idle') return;
    try {
      await localRecompute(new Set(LOCAL_KINDS));
    } finally {
      if (!stopped && activity === 'idle') deps.scheduleRemote(0);
    }
  }

  return {
    setActivity(next) {
      if (stopped || next === activity) return;
      activity = next;
      if (next === 'active') {
        void serial(tierUp);
        return;
      }
      stopProbeLoop();
      localScheduler.cancel();
      deps.cancelRemote();
      void serial(finalFlush);
    },

    refresh() {
      return serial(async () => {
        lastHash.clear();
        lastTriggerAt = now();
        localScheduler.cancel();
        await localRecompute(new Set(LOCAL_KINDS));
        if (!stopped) deps.scheduleRemote(0);
      });
    },

    runRemotePoll() {
      return serial(async () => {
        try {
          await pollRemote();
        } catch (err) {
          logError(err);
          onRemoteFailure();
        }
      });
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      stopProbeLoop();
      localScheduler.cancel();
      deps.cancelRemote();
      await chain;
    },
  };
}
