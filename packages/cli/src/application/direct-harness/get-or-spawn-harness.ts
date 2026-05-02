/**
 * HarnessProcessRegistry — maintains one harness process per workspace.
 *
 * Responsibilities:
 * - One running harness process per workspaceId (identified by Convex Id)
 * - Per-workspace promise cache guards against concurrent spawn racing
 * - Failed processes are evicted so the next caller triggers a fresh spawn
 * - Calls `onHarnessBooted` callback (if set) after each successful new spawn
 * - v1 process lifecycle: processes are torn down on daemon shutdown only
 *   (no per-session cleanup). The registry's `killAll()` is called on shutdown.
 */

import type { DirectHarnessSpawner, PublishedAgent } from '../../domain/direct-harness/index.js';

// ─── Types ─────────────────────────────────────────────────────────────────

/** Factory that starts a harness process for a given cwd and returns a HarnessProcess. */
export type HarnessProcessFactory = (workspaceId: string, cwd: string) => Promise<HarnessProcess>;

/** Callback fired after a new harness process boots. Fire-and-forget — errors are swallowed. */
export type OnHarnessBooted = (process: HarnessProcess) => Promise<void>;

/**
 * A running harness process associated with a workspace.
 * The `spawner` is pre-bound to the running process and its `openSession()`
 * creates new sessions without spawning additional processes.
 */
export interface HarnessProcess {
  /** The workspace this process is serving. */
  readonly workspaceId: string;
  /** Spawner pre-bound to the running harness process. */
  readonly spawner: DirectHarnessSpawner;
  /** Returns true if the process is still running and healthy. */
  isAlive(): boolean;
  /** Tear down the harness process. Idempotent. */
  kill(): Promise<void>;
  /**
   * Fetch the published agent list from the running harness.
   * Returns an empty array if the harness does not support agent listing.
   */
  listAgents(): Promise<readonly PublishedAgent[]>;
}

// ─── Registry ──────────────────────────────────────────────────────────────

/**
 * In-process registry that maps workspaceId → HarnessProcess.
 *
 * Thread safety: a per-workspace Promise is stored during spawn to prevent
 * duplicate processes from two concurrent `getOrSpawn` calls.
 */
export class HarnessProcessRegistry {
  /** Settled entries — workspaceId → live process. */
  private readonly processes = new Map<string, HarnessProcess>();
  /** In-flight entries — workspaceId → Promise during the spawn phase. */
  private readonly pending = new Map<string, Promise<HarnessProcess>>();
  /** Optional callback fired after each new process boots. */
  private onBooted?: OnHarnessBooted;

  constructor(private readonly factory: HarnessProcessFactory) {}

  /**
   * Register a callback to fire after each new harness process boots.
   * Errors from the callback are swallowed — it is fire-and-forget.
   */
  setOnHarnessBooted(callback: OnHarnessBooted): void {
    this.onBooted = callback;
  }

  /**
   * Return the existing healthy process for the workspace, or spawn a new one.
   * Concurrent callers for the same workspaceId share the same Promise.
   */
  async getOrSpawn(workspaceId: string, cwd: string): Promise<HarnessProcess> {
    // Fast path: existing healthy process
    const existing = this.processes.get(workspaceId);
    if (existing?.isAlive()) {
      return existing;
    }

    // Evict dead process from the map before spawning
    if (existing && !existing.isAlive()) {
      this.processes.delete(workspaceId);
    }

    // Dedup concurrent spawns for the same workspace
    const inFlight = this.pending.get(workspaceId);
    if (inFlight) {
      return inFlight;
    }

    const spawnPromise = this.factory(workspaceId, cwd).then(
      (process) => {
        this.pending.delete(workspaceId);
        this.processes.set(workspaceId, process);

        // Fire-and-forget onBooted callback
        if (this.onBooted) {
          void this.onBooted(process).catch(() => {
            // Swallow — capability publishing is best-effort
          });
        }

        return process;
      },
      (err) => {
        // Evict on failure so the next call retries
        this.pending.delete(workspaceId);
        throw err;
      }
    );

    this.pending.set(workspaceId, spawnPromise);
    return spawnPromise;
  }

  /**
   * Invalidate a specific workspace's harness process.
   * The next `getOrSpawn` call will trigger a fresh spawn.
   */
  invalidate(workspaceId: string): void {
    this.processes.delete(workspaceId);
    this.pending.delete(workspaceId);
  }

  /**
   * Kill all running harness processes. Call on daemon shutdown.
   * v1: processes run until daemon exit — no per-session cleanup.
   */
  async killAll(): Promise<void> {
    const kills = [...this.processes.values()].map((p) =>
      p.kill().catch(() => {
        /* best-effort on shutdown */
      })
    );
    await Promise.all(kills);
    this.processes.clear();
  }

  /** Returns the number of currently tracked (live) processes. */
  get size(): number {
    return this.processes.size;
  }
}
