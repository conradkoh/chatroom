/**
 * HarnessLifecycleManager — auto-starts harnesses on demand and kills them
 * after a configurable inactivity period.
 *
 * "Inactivity" = no entry in activeSessions has workspaceId matching the
 * harness. The manager polls every CHECK_INTERVAL_MS and kills any harness
 * that has been continuously idle for longer than INACTIVITY_TTL_MS.
 */

import { Effect } from 'effect';

import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionHandle } from '../../../../domain/direct-harness/usecases/open-session.js';
import { startOpencodeSdkHarness } from '../../../../infrastructure/harnesses/opencode-sdk/index.js';
import { formatTimestamp } from '../utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Kill a harness that has been idle longer than this. */
const INACTIVITY_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** How often to check for idle harnesses. */
const CHECK_INTERVAL_MS = 60 * 1000; // every minute

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal workspace info needed to start a harness. */
interface WorkspaceInfo {
  workingDir: string;
}

/** Resolves workspace info from the backend. */
export type WorkspaceResolver = (workspaceId: string) => Promise<WorkspaceInfo | null>;

// ─── HarnessLifecycleManager ──────────────────────────────────────────────────

export class HarnessLifecycleManager {
  /**
   * Tracks when each workspace's harness first became idle (no active sessions).
   * Reset whenever a session becomes active again.
   */
  private readonly idleSince = new Map<string, number>();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    /** Shared map of running harnesses, keyed by workspaceId. */
    private readonly harnesses: Map<string, BoundHarness>,
    /** Shared map of active sessions — workspaceId is on each handle. */
    private readonly activeSessions: Map<string, SessionHandle>,
    /** Looks up workspace workingDir from the backend. */
    private readonly resolveWorkspace: WorkspaceResolver
  ) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Effect twin — return running harness, auto-starting if needed. */
  private getOrStartHarnessEffect(workspaceId: string): Effect.Effect<BoundHarness, Error, never> {
    const existing = this.harnesses.get(workspaceId);
    if (existing) return Effect.succeed(existing);

    return Effect.gen(this, function* () {
      const workspace = yield* Effect.tryPromise({
        try: () => this.resolveWorkspace(workspaceId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });
      if (!workspace) {
        return yield* Effect.fail(
          new Error(`Workspace ${workspaceId} not found — cannot start harness`)
        );
      }

      console.log(
        `[${formatTimestamp()}] 🔧 Auto-starting harness for workspace=${workspaceId} (${workspace.workingDir})`
      );

      const harness = yield* Effect.tryPromise({
        try: () =>
          startOpencodeSdkHarness({
            type: 'opencode',
            workingDir: workspace.workingDir,
            workspaceId,
          }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      this.harnesses.set(workspaceId, harness);
      this.idleSince.set(workspaceId, Date.now());
      return harness;
    });
  }

  /**
   * Return the running harness for a workspace, starting one if needed.
   * After auto-starting, the inactivity clock begins immediately.
   */
  async getOrStart(workspaceId: string): Promise<BoundHarness> {
    return Effect.runPromise(this.getOrStartHarnessEffect(workspaceId));
  }

  /** Start the periodic inactivity monitor. Safe to call multiple times. */
  startMonitoring(): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => this.checkInactivity(), CHECK_INTERVAL_MS);
    // Don't keep the process alive solely for the timer
    this.monitorTimer.unref();
  }

  /** Stop the inactivity monitor timer (does NOT kill harnesses). */
  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private checkInactivity(): void {
    const now = Date.now();

    for (const workspaceId of this.harnesses.keys()) {
      const hasActiveSessions = this.hasSessionsForWorkspace(workspaceId);

      if (hasActiveSessions) {
        // Still busy — reset idle clock
        this.idleSince.delete(workspaceId);
      } else {
        // No sessions — start or continue the idle clock
        const idleStart = this.idleSince.get(workspaceId);

        if (idleStart === undefined) {
          this.idleSince.set(workspaceId, now);
        } else if (now - idleStart >= INACTIVITY_TTL_MS) {
          const idleMinutes = Math.round((now - idleStart) / 60_000);
          console.log(
            `[${formatTimestamp()}] 🔪 Killing idle harness for workspace=${workspaceId} (idle ${idleMinutes}min)`
          );
          this.harnesses
            .get(workspaceId)
            ?.close()
            .catch(() => {});
          this.harnesses.delete(workspaceId);
          this.idleSince.delete(workspaceId);
        }
      }
    }
  }

  private hasSessionsForWorkspace(workspaceId: string): boolean {
    for (const handle of this.activeSessions.values()) {
      if (handle.workspaceId === workspaceId) return true;
    }
    return false;
  }
}
