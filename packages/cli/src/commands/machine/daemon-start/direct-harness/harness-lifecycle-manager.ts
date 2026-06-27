/**
 * HarnessLifecycleManager — auto-starts harnesses on demand and kills them
 * after a configurable inactivity period.
 *
 * Harnesses are keyed by `workspaceId:harnessName` so multiple harness types
 * can coexist per workspace. "Inactivity" = no active session for that key.
 */

import { Effect } from 'effect';

import type {
  BoundHarness,
  NativeDirectHarnessName,
} from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionHandle } from '../../../../domain/direct-harness/usecases/open-session.js';
import {
  makeHarnessKey,
  parseHarnessKey,
} from '../../../../infrastructure/harnesses/harness-key.js';
import { startBoundHarness } from '../../../../infrastructure/harnesses/registry.js';
import { formatTimestamp } from '../utils.js';

const INACTIVITY_TTL_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

interface WorkspaceInfo {
  workingDir: string;
}

export type WorkspaceResolver = (workspaceId: string) => Promise<WorkspaceInfo | null>;

export class HarnessLifecycleManager {
  private readonly idleSince = new Map<string, number>();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly harnesses: Map<string, BoundHarness>,
    private readonly activeSessions: Map<string, SessionHandle>,
    private readonly resolveWorkspace: WorkspaceResolver,
    private readonly resolvedConvexUrl: string
  ) {}

  private getOrStartHarnessEffect(
    workspaceId: string,
    harnessName: NativeDirectHarnessName
  ): Effect.Effect<BoundHarness, Error, never> {
    const key = makeHarnessKey(workspaceId, harnessName);
    const existing = this.harnesses.get(key);
    if (existing?.isAlive()) return Effect.succeed(existing);

    if (existing) {
      existing.close().catch(() => {});
      this.harnesses.delete(key);
    }

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
        `[${formatTimestamp()}] 🔧 Auto-starting ${harnessName} for workspace=${workspaceId} (${workspace.workingDir})`
      );

      const harness = yield* Effect.tryPromise({
        try: () =>
          startBoundHarness({
            harnessName,
            workingDir: workspace.workingDir,
            workspaceId,
            resolvedConvexUrl: this.resolvedConvexUrl,
          }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      this.harnesses.set(key, harness);
      this.idleSince.set(key, Date.now());
      return harness;
    });
  }

  async getOrStart(
    workspaceId: string,
    harnessName: NativeDirectHarnessName
  ): Promise<BoundHarness> {
    return Effect.runPromise(this.getOrStartHarnessEffect(workspaceId, harnessName));
  }

  startMonitoring(): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => this.checkInactivity(), CHECK_INTERVAL_MS);
    this.monitorTimer.unref();
  }

  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  private checkInactivity(): void {
    const now = Date.now();

    for (const key of this.harnesses.keys()) {
      const { workspaceId, harnessName } = parseHarnessKey(key);
      const hasActiveSessions = this.hasSessionsForHarnessKey(workspaceId, harnessName);

      if (hasActiveSessions) {
        this.idleSince.delete(key);
      } else {
        const idleStart = this.idleSince.get(key);
        if (idleStart === undefined) {
          this.idleSince.set(key, now);
        } else if (now - idleStart >= INACTIVITY_TTL_MS) {
          const idleMinutes = Math.round((now - idleStart) / 60_000);
          console.log(
            `[${formatTimestamp()}] 🔪 Killing idle harness ${harnessName} for workspace=${workspaceId} (idle ${idleMinutes}min)`
          );
          this.harnesses
            .get(key)
            ?.close()
            .catch(() => {});
          this.harnesses.delete(key);
          this.idleSince.delete(key);
        }
      }
    }
  }

  private hasSessionsForHarnessKey(workspaceId: string, harnessName: string): boolean {
    for (const handle of this.activeSessions.values()) {
      if (handle.workspaceId === workspaceId && handle.harnessName === harnessName) {
        return true;
      }
    }
    return false;
  }
}
